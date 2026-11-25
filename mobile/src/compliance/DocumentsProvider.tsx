import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { client } from "../runtime/appContext";
import { createComplianceApi } from "./complianceApi";
import { createDocumentStore, type DocumentStore } from "./documentStore";

const DocumentsContext = createContext<DocumentStore | null>(null);

/** The documents module: one person's own documents, held in memory and gone when the account signs out. */
export function DocumentsProvider({ userId, children }: { userId: number; children: ReactNode }) {
  const store = useMemo(() => createDocumentStore(createComplianceApi(client)), [userId]);
  return <DocumentsContext.Provider value={store}>{children}</DocumentsContext.Provider>;
}

/** Test seam: the screens on a store the test made. */
export const DocumentsContextProvider = DocumentsContext.Provider;

export function useDocuments() {
  const store = useContext(DocumentsContext);
  if (!store) throw new Error("document screens must be inside DocumentsProvider");
  return { store, snap: useSyncExternalStore(store.subscribe, store.getSnapshot) };
}
