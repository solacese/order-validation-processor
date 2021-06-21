/**
 * index.js
 * @author Andrew Roberts
 */

// polyfill async
import "core-js/stable";
import "regenerator-runtime";

// app modules
import { createSolaceClient } from "./solace-client";
import { solaceConfig } from "./solace.config";

async function run() {
  // // config file version
  let solaceClientConfig = {
    url: solaceConfig.SOLACE_HOST_URL,
    vpnName: solaceConfig.SOLACE_MESSAGE_VPN,
    userName: solaceConfig.SOLACE_USERNAME,
    password: solaceConfig.SOLACE_PASSWORD,
  };

  let solaceClient = createSolaceClient(solaceClientConfig);

  solaceClient = await solaceClient.connectMessageConsumer("OrderValidationProcessor").catch(() => {
    // handle retry logic here, for this simulator just blow up if connection fails
    console.error("Error connecting.");
    process.exit(1);
  });

  // run until sigint
  console.log("Running until a SIGINT signal is received...");
  process.stdin.resume();
  process.on("SIGINT", function () {
    console.log("+-+-+-+-+-+-+-+-+-+-+-+-+-+");
    console.log("+-+-+-+-+-+-+-+-+-+-+-+-+-+");
    process.exit();
  });
}

console.log("+-+-+-+-+-+-+-+-+-+-+-+-+-+");
console.log("+-+-+-+-+-+-+-+-+-+-+-+-+-+");
console.log(new Date().toLocaleTimeString());
console.log("Starting Node.js worker...");

run();
