// resources.bicep — Sora 2 video-generation stack (resource-group scope).
// Deployed as a module from main.bicep. Everything is name-derived from
// `namePrefix` + a hash of the target scope, so the same file clones cleanly
// into any resource group / subscription without name collisions.

targetScope = 'resourceGroup'

@description('Short prefix for resource names, e.g. "dancinggrandma".')
@minLength(2)
@maxLength(20)
param namePrefix string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Sora model version to deploy. Query available versions with: az cognitiveservices model list -l <region> --query "[?model.name==\'sora-2\']".')
param soraVersion string = '2025-12-08'

@description('Deployment capacity in GlobalStandard units. Raise for more concurrent generations.')
@minValue(1)
param soraCapacity int = 1

@description('Name of the Sora deployment — this is the "model" name you pass to the video API.')
param soraDeploymentName string = 'sora-2'

// Stable per-scope suffix keeps names unique across clones (13 chars).
var suffix = uniqueString(subscription().id, resourceGroup().id, namePrefix)
var aiAccountName = toLower('${namePrefix}-ai-${suffix}')
var storageName = toLower('stg${suffix}') // 3 + 13 = 16 chars, within 3–24 limit

// Azure AI Foundry account — hosts the Sora model and exposes the OpenAI-style endpoint.
resource ai 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: aiAccountName
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: aiAccountName // required for the OpenAI/video endpoints
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false // keep API-key auth on for a simple demo
  }
}

// Sora 2 model deployment.
resource soraDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: ai
  name: soraDeploymentName
  sku: {
    name: 'GlobalStandard'
    capacity: soraCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'sora-2'
      version: soraVersion
    }
  }
}

// Storage for the generated clips.
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource videosContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'videos'
}

output aiAccountName string = ai.name
output aiEndpoint string = ai.properties.endpoint
output soraDeploymentName string = soraDeployment.name
output storageAccountName string = storage.name
output videosContainer string = videosContainer.name
