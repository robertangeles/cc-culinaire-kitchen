import { client } from "./appContext";
import { createReceivingApi } from "../receiving/receivingApi";

/** The one receiving API for the app (screens never call fetch). */
export const receivingApi = createReceivingApi(client);
