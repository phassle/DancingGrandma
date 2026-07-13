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
        .WithInitFiles("./db/init")
        // Persist users, credits, and generations across restarts (issue #99).
        // Init scripts run once on first init; later starts reuse the volume.
        .WithDataVolume());
var db = postgres.AddDatabase("grandmadb");

// --- Blob storage for generated videos (Azurite locally) ------------------
var storage = builder.AddAzureStorage("storage").RunAsEmulator();
var videos = storage.AddBlobContainer("videos");

// --- Mailpit: local mail catcher for password-reset emails (issue #100) ---
// Keycloak's realm SMTP points at mailpit:1025; read the messages in the UI.
// Local dev only — production wires a real SMTP provider.
var mailpit = builder.AddContainer("mailpit", "axllent/mailpit")
    .WithEndpoint(targetPort: 1025, name: "smtp", scheme: "tcp")
    .WithHttpEndpoint(targetPort: 8025, name: "ui");

// --- Keycloak: auth server with the dancinggrandma realm ------------------
var keycloak = builder.AddKeycloak("keycloak", 8080)
    // Persist the H2 store so runtime-registered users survive restarts
    // (issue #99). Realm import stays idempotent.
    .WithDataVolume()
    .WithRealmImport("./keycloak/realms")
    .WaitFor(mailpit);

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

// --- Stripe webhook forwarder (local dev only, issue #98) -----------------
// Fulfillment is webhook-only, so a bare `aspire run` leaves a paid checkout
// stuck "finalizing" forever. Run the Stripe CLI listener alongside the app
// and forward events to the pinned :3000 endpoint. It authenticates with the
// configured stripe-secret-key (no `stripe login` needed); the CLI's signing
// secret is account-stable and already equals stripe-webhook-secret. Requires
// the `stripe` CLI on PATH — without it this shows as a failed optional
// resource while the rest of the stack runs. Publish/deploy uses a real
// endpoint, so this is run-mode only.
if (builder.ExecutionContext.IsRunMode)
{
    builder.AddExecutable(
            "stripe-webhooks", "stripe", ".",
            "listen", "--forward-to", "http://localhost:3000/api/stripe/webhook")
        .WithArgs(context =>
        {
            context.Args.Add("--api-key");
            context.Args.Add(stripeSecretKey.Resource);
        })
        .WaitFor(web);
}

// --- Azure-only shape: Container Apps behind Front Door (issue #31) -------
if (builder.ExecutionContext.IsPublishMode)
{
    builder.AddAzureContainerAppEnvironment("app-env");

    builder.AddBicepTemplate("frontdoor", "infra/frontdoor.bicep")
        .WithParameter("originHostname",
            ReferenceExpression.Create($"{web.GetEndpoint("http").Property(EndpointProperty.Host)}"));
}

builder.Build().Run();
