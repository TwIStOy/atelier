import { makeRefreshCommandHandler } from "@htwang-contrib/common";

export const PROVIDER_ID = "magpie";
export const COMMAND_NAME = "refresh-magpie";

export const handleRefreshCommand = makeRefreshCommandHandler(PROVIDER_ID, PROVIDER_ID);
