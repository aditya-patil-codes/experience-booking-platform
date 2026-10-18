import { env } from "./config";
import { app } from "./app";

app.listen(env.PORT, () => console.log(`API listening on :${env.PORT}`));