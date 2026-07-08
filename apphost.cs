#:package Aspire.Hosting.Azure.AppContainers@13.4.6
#:package Aspire.Hosting.Azure.PostgreSQL@13.4.6
#:package Aspire.Hosting.Azure.Storage@13.4.6
#:package Aspire.Hosting.JavaScript@13.4.6
#:package Aspire.Hosting.Keycloak@13.4.6-preview.1.26319.6
#:sdk Aspire.AppHost.Sdk@13.4.6

// DancingGrandma app model — one `aspire run` for the whole local stack,
// one `aspire publish`/`aspire deploy` for the Azure shape (issue #32).
//
// Local:   Next.js dev server + Postgres container + Azurite + Keycloak.
// Cloud:   Container Apps environment + Azure Postgres Flexible Server +
//          Azure Storage + Keycloak container, fronted by Azure Front Door.
//
// Public repo: no resource groups, subscriptions, or keys here. Sora values
// live in appsettings.Development.json (gitignored) — see the .example file.

var builder = DistributedApplication.CreateBuilder(args);

// --- Azure AI Foundry / Sora connection (existing Foundry account) --------
// Resolve endpoint + key the same way scripts/generate-grandma.sh does, then
// put them in appsettings.Development.json under Parameters.
var soraEndpoint = builder.AddParameter("sora-endpoint");
var soraApiKey = builder.AddParameter("sora-api-key", secret: true);
var soraDeployment = builder.AddParameter("sora-deployment", value: "sora-2");

// --- Stripe: the $9.99/month subscription (PRD #54) -----------------------
// Test-mode values live in appsettings.Development.json (gitignored) — see
// the .example file. Fulfillment is webhook-only; use `stripe listen
// --forward-to <web>/api/stripe/webhook` locally for the signing secret.
var stripeSecretKey = builder.AddParameter("stripe-secret-key", secret: true);
var stripeWebhookSecret = builder.AddParameter("stripe-webhook-secret", secret: true);
var stripePriceId = builder.AddParameter("stripe-price-id");

// --- Postgres: users, video generations, credits ledger -------------------
var postgres = builder.AddAzurePostgresFlexibleServer("postgres")
    .WithPasswordAuthentication()
    .RunAsContainer(c => c
        // Make grandmadb the container's default database so the init
        // scripts run against it (initdb happens before AddDatabase kicks in).
        .WithEnvironment("POSTGRES_DB", "grandmadb")
        .WithInitFiles("./db/init"));
var db = postgres.AddDatabase("grandmadb");

// --- Blob storage for generated videos (Azurite locally) ------------------
var storage = builder.AddAzureStorage("storage").RunAsEmulator();
var videos = storage.AddBlobContainer("videos");

// --- Keycloak: auth server with the dancinggrandma realm ------------------
var keycloak = builder.AddKeycloak("keycloak", 8080)
    .WithRealmImport("./keycloak/realms");

// --- The Next.js app -------------------------------------------------------
#pragma warning disable ASPIREJAVASCRIPT001 // AddNextJsApp is evaluation-stage in 13.4
var web = builder.AddNextJsApp("web", ".")
    .WithReference(db).WaitFor(db)
    .WithReference(videos).WaitFor(videos)
    .WithReference(keycloak).WaitFor(keycloak)
    .WithEnvironment("SORA_ENDPOINT", soraEndpoint)
    .WithEnvironment("SORA_API_KEY", soraApiKey)
    .WithEnvironment("SORA_DEPLOYMENT", soraDeployment)
    .WithEnvironment("STRIPE_SECRET_KEY", stripeSecretKey)
    .WithEnvironment("STRIPE_WEBHOOK_SECRET", stripeWebhookSecret)
    .WithEnvironment("STRIPE_PRICE_ID", stripePriceId)
    // Pin the browser-facing port: Keycloak redirect URIs cannot wildcard a
    // port, so the realm whitelists http://localhost:3000 explicitly.
    .WithEndpoint("http", e => e.Port = 3000)
    .WithExternalHttpEndpoints();
#pragma warning restore ASPIREJAVASCRIPT001

// --- Azure-only shape: Container Apps behind Front Door (issue #31) -------
if (builder.ExecutionContext.IsPublishMode)
{
    builder.AddAzureContainerAppEnvironment("app-env");

    builder.AddBicepTemplate("frontdoor", "infra/frontdoor.bicep")
        .WithParameter("originHostname",
            ReferenceExpression.Create($"{web.GetEndpoint("http").Property(EndpointProperty.Host)}"));
}

builder.Build().Run();
