import { execFile } from "child_process";
import { join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Route-handler test harness (PRD #54): a throwaway Postgres container with
 * the real db/init schema applied, so tests exercise route handlers against a
 * real database. Only true externals (identity token verification, Stripe,
 * providers, blob storage) are faked at their client boundaries.
 *
 * Usage:
 *   const pg = await startTestPostgres();          // in beforeAll
 *   process.env.ConnectionStrings__grandmadb = pg.connectionString;
 *   ...
 *   await closePool(); await pg.stop();            // in afterAll
 */
export type TestPostgres = {
  /** ADO.NET-style connection string, the shape the apphost injects. */
  connectionString: string;
  stop(): Promise<void>;
};

const IMAGE = "postgres:18.3";
const PASSWORD = "grandma-test";

export async function startTestPostgres(): Promise<TestPostgres> {
  const initDir = join(process.cwd(), "db", "init");
  const { stdout: runOut } = await execFileAsync("docker", [
    "run",
    "-d",
    "--rm",
    "-e",
    `POSTGRES_PASSWORD=${PASSWORD}`,
    "-e",
    "POSTGRES_DB=grandmadb",
    "-p",
    "127.0.0.1:0:5432",
    "-v",
    `${initDir}:/docker-entrypoint-initdb.d:ro`,
    IMAGE,
  ]);
  const containerId = runOut.trim();
  const stop = async () => {
    await execFileAsync("docker", ["stop", containerId]).catch(() => undefined);
  };

  try {
    const { stdout: portOut } = await execFileAsync("docker", ["port", containerId, "5432/tcp"]);
    const hostPort = portOut.trim().split("\n")[0]!.split(":").pop()!;

    // The entrypoint runs init scripts against a temporary server that only
    // listens on the unix socket; TCP readiness means the schema is applied
    // and the final server is up.
    for (let attempt = 0; ; attempt++) {
      const ready = await execFileAsync("docker", [
        "exec",
        containerId,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
        "-d",
        "grandmadb",
      ]).then(
        () => true,
        () => false,
      );
      if (ready) break;
      if (attempt >= 240) throw new Error("test postgres did not become ready in time");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return {
      connectionString: `Host=127.0.0.1;Port=${hostPort};Username=postgres;Password=${PASSWORD};Database=grandmadb`,
      stop,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}
