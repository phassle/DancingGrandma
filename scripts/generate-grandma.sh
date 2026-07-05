#!/usr/bin/env bash
# Generate a video with Sora 2 on Azure AI Foundry and download the MP4.
#
# Resolves the endpoint + key from a resource group at runtime — no resource
# group, subscription, or key is hard-coded (public repo).
#
# Usage:
#   RG=<your-resource-group> ./scripts/generate-grandma.sh [prompt] [size] [seconds]
#
# Examples:
#   RG=rg-example ./scripts/generate-grandma.sh
#   RG=rg-example ./scripts/generate-grandma.sh "grandma breakdancing on the moon" 1280x720 8
#
# Env:
#   RG        (required) resource group holding the AI Foundry account
#   ACCOUNT   (optional) account name; defaults to the first one in the RG
#   OUT       (optional) output file; defaults to ./grandma-dancing.mp4
set -euo pipefail

RG="${RG:?set RG to your resource group}"
PROMPT="${1:-A cheerful grandma dancing joyfully in a cozy warmly-lit living room, smooth gentle camera motion}"
SIZE="${2:-1280x720}"
SECONDS_LEN="${3:-4}"
OUT="${OUT:-grandma-dancing.mp4}"

ACCOUNT="${ACCOUNT:-$(az cognitiveservices account list -g "$RG" --query "[0].name" -o tsv)}"
[ -n "$ACCOUNT" ] || { echo "No Cognitive Services account found in $RG" >&2; exit 1; }

# Sora lives on the *.openai.azure.com endpoint, not properties.endpoint.
OAI=$(az cognitiveservices account show -g "$RG" -n "$ACCOUNT" \
  --query 'properties.endpoints."OpenAI Sora API"' -o tsv)
KEY=$(az cognitiveservices account keys list -g "$RG" -n "$ACCOUNT" --query key1 -o tsv)
API="api-version=preview"

echo "account : $ACCOUNT"
echo "endpoint: $OAI"
echo "prompt  : $PROMPT"

VID=$(curl -sf "${OAI}openai/v1/videos?${API}" \
  -H "api-key: $KEY" -H "Content-Type: application/json" \
  -d "$(jq -n --arg p "$PROMPT" --arg s "$SIZE" --arg sec "$SECONDS_LEN" \
        '{model:"sora-2", prompt:$p, size:$s, seconds:$sec}')" | jq -r .id)
[ -n "$VID" ] && [ "$VID" != "null" ] || { echo "Failed to create job" >&2; exit 1; }
echo "video   : $VID"

while :; do
  J=$(curl -sf "${OAI}openai/v1/videos/${VID}?${API}" -H "api-key: $KEY")
  ST=$(echo "$J" | jq -r .status)
  echo "  status=$ST progress=$(echo "$J" | jq -r .progress)"
  case "$ST" in
    completed) break ;;
    failed) echo "$J" | jq .error >&2; exit 1 ;;
  esac
  sleep 10
done

curl -sf "${OAI}openai/v1/videos/${VID}/content?${API}" -H "api-key: $KEY" --output "$OUT"
echo "saved   : $OUT"
