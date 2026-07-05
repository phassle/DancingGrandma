# Sora 2 video-generation infrastructure

Bicep for the Azure resources that let this project generate video (e.g. *farmor
som dansar*) with **Sora 2** via Azure AI Foundry.

## What gets created

| Resource | Type | Purpose |
|----------|------|---------|
| AI Foundry account | `Microsoft.CognitiveServices/accounts` (`AIServices`) | Hosts the model, gives you the endpoint + key |
| Sora 2 deployment | `.../accounts/deployments` (`GlobalStandard`) | The `sora-2` model you call |
| Storage account | `Microsoft.Storage/storageAccounts` | Persist the generated clips |
| `videos` container | `.../blobServices/containers` | Blob container for output |

All names derive from `namePrefix` + a hash of the target scope, so the stack
clones without collisions.

## Files

- `main.bicep` — subscription-scoped entry point; creates the resource group, then the stack.
- `resources.bicep` — the resources (module, resource-group scope).
- `main.bicepparam.example` — template parameters. Copy to `main.bicepparam` (gitignored) and fill in.

> **Public repo:** the resource group and subscription are never committed.
> Provide them at deploy time — either in your local `infra/main.bicepparam`
> (gitignored) or via `--parameters` / `--subscription` on the command line.

## Setup

```bash
cp infra/main.bicepparam.example infra/main.bicepparam
# edit infra/main.bicepparam and set resourceGroupName (and anything else)
```

## Deploy

```bash
az deployment sub create \
  --subscription <your-subscription-id> \
  --location swedencentral \
  --parameters infra/main.bicepparam
```

Preview first (no changes made):

```bash
az deployment sub what-if \
  --subscription <your-subscription-id> \
  --location swedencentral \
  --parameters infra/main.bicepparam
```

## Clone the whole stack elsewhere

**Different resource group** — override one parameter:

```bash
az deployment sub create --location swedencentral \
  --subscription <your-subscription-id> \
  --parameters infra/main.bicepparam \
  --parameters resourceGroupName=<other-rg>
```

**Different subscription** — point `--subscription` elsewhere:

```bash
az deployment sub create --location swedencentral \
  --subscription <other-subscription-id> \
  --parameters infra/main.bicepparam \
  --parameters resourceGroupName=<your-rg>
```

Nothing in the Bicep is hard-coded to a subscription; the RG name and region are
the only things you change to relocate everything.

## Generate a video after deploy

Verified end-to-end with `sora-2` (version `2025-12-08`). Sora uses the
**`*.openai.azure.com`** endpoint (not the default `cognitiveservices` one) and
the OpenAI-style `/openai/v1/videos` API with `api-version=preview`.

Grab the Sora endpoint and key (set `RG` to your resource group):

```bash
RG=<your-resource-group>
ACC=$(az cognitiveservices account list -g $RG --query "[0].name" -o tsv)
# NOTE: the "OpenAI Sora API" endpoint, not properties.endpoint
OAI=$(az cognitiveservices account show -g $RG -n $ACC --query 'properties.endpoints."OpenAI Sora API"' -o tsv)
KEY=$(az cognitiveservices account keys list -g $RG -n $ACC --query key1 -o tsv)
```

Create a generation job (fields are strings: `size` like `1280x720`, `seconds` like `4`/`8`/`12`):

```bash
VID=$(curl -s "${OAI}openai/v1/videos?api-version=preview" \
  -H "api-key: $KEY" -H "Content-Type: application/json" \
  -d '{
        "model": "sora-2",
        "prompt": "A cheerful grandma dancing joyfully in a cozy living room, warm light, smooth camera",
        "size": "1280x720", "seconds": "8"
      }' | jq -r .id)
echo "video: $VID"
```

Poll until `status == completed`, then download the MP4:

```bash
curl -s "${OAI}openai/v1/videos/${VID}?api-version=preview" \
  -H "api-key: $KEY" | jq '{status, progress, error}'

# once completed:
curl -s "${OAI}openai/v1/videos/${VID}/content?api-version=preview" \
  -H "api-key: $KEY" --output grandma-dancing.mp4
```

> API surface (preview) can change — if a field is rejected, check the current
> Azure AI Foundry Sora docs. The infra above is what Sora needs regardless.
