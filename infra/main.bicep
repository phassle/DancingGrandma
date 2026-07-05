// main.bicep — subscription-scoped entry point for the Sora 2 stack.
//
// Clone the whole thing elsewhere with ZERO file edits:
//   • different resource group  →  --parameters resourceGroupName=<your-rg>
//   • different subscription    →  az deployment sub create --subscription <id> ...
//
// The resource group is created if it does not exist. No resource group or
// subscription is hard-coded here — supply them at deploy time (see README).

targetScope = 'subscription'

@description('Resource group to deploy into. Supplied at deploy time (kept out of the repo).')
param resourceGroupName string

@description('Azure region. Sora 2 is available in swedencentral and eastus2.')
param location string = 'swedencentral'

@description('Short prefix for resource names.')
param namePrefix string = 'dancinggrandma'

@description('Sora model version to deploy.')
param soraVersion string = '2025-12-08'

@description('Deployment capacity in GlobalStandard units.')
param soraCapacity int = 1

@description('Name of the Sora deployment (the "model" name used by the video API).')
param soraDeploymentName string = 'sora-2'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
}

module stack 'resources.bicep' = {
  name: 'sora-stack'
  scope: rg
  params: {
    namePrefix: namePrefix
    location: location
    soraVersion: soraVersion
    soraCapacity: soraCapacity
    soraDeploymentName: soraDeploymentName
  }
}

output resourceGroupName string = rg.name
output aiAccountName string = stack.outputs.aiAccountName
output aiEndpoint string = stack.outputs.aiEndpoint
output soraDeploymentName string = stack.outputs.soraDeploymentName
output storageAccountName string = stack.outputs.storageAccountName
