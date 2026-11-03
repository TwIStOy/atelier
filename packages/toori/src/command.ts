import { makeRefreshCommandHandler } from "@htwang-contrib/common";
import { ENV_VAR } from "./catalog.ts";

export const PROVIDER_ID = "toori";
export const COMMAND_NAME = "refresh-toori";
export { ENV_VAR };

export const handleRefreshCommand = makeRefreshCommandHandler(PROVIDER_ID, PROVIDER_ID, { envVar: ENV_VAR });
