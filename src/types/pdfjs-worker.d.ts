/** pdf.js's worker, imported into the page so pdf.js runs without a separate worker file. */
declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs" {
  export const WorkerMessageHandler: unknown;
}
