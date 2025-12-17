import http from "node:http";
import { createSchema } from "./bootstrap/createSchema";
import { loadEnvFromFile } from "./config/env";

loadEnvFromFile();

async function start() {
  console.info("Bootstrapping database schema before starting the server…");

  try {
    const result = await createSchema();
    console.info(result.message);
  } catch (error) {
    console.error("Schema bootstrap failed. Aborting server startup.", error);
    process.exit(1);
  }

  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        status: "ok",
        message: "TheTrendScope backend is running",
      })
    );
  });

  server.listen(port, () => {
    console.info(`Server is ready on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Unexpected startup failure", error);
  process.exit(1);
});
