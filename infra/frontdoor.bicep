// frontdoor.bicep — Azure Front Door (Standard) in front of the web container app.
// Referenced from apphost.cs via AddBicepTemplate in publish mode (issues #31, #32).
// The origin hostname is wired in by Aspire from the web app's endpoint.

@description('Public hostname of the origin (the web container app FQDN).')
param originHostname string

@description('Deployment location for the profile metadata (Front Door itself is global).')
param location string = 'global'

var suffix = uniqueString(resourceGroup().id, 'dancinggrandma-afd')

resource profile 'Microsoft.Cdn/profiles@2024-02-01' = {
  name: 'afd-dancinggrandma-${suffix}'
  location: location
  sku: {
    name: 'Standard_AzureFrontDoor'
  }
}

resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' = {
  parent: profile
  name: 'web'
  location: location
  properties: {
    enabledState: 'Enabled'
  }
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = {
  parent: profile
  name: 'web-origins'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/'
      probeRequestType: 'HEAD'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 100
    }
  }
}

resource origin 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = {
  parent: originGroup
  name: 'web'
  properties: {
    hostName: originHostname
    originHostHeader: originHostname
    httpPort: 80
    httpsPort: 443
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
  }
}

resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = {
  parent: endpoint
  name: 'default'
  properties: {
    originGroup: {
      id: originGroup.id
    }
    supportedProtocols: [
      'Http'
      'Https'
    ]
    patternsToMatch: [
      '/*'
    ]
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    httpsRedirect: 'Enabled'
  }
  dependsOn: [
    origin
  ]
}

output frontDoorHostname string = endpoint.properties.hostName
