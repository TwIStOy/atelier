import { fetchModels } from "./sync.ts";

const models = await fetchModels();
console.log(JSON.stringify(models, null, 2));
