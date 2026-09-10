// Canonical Neurodesk webapp entry. The interface is assembled entirely from
// the shared workspace vocabulary; only the scientific logic is app-owned.
import "@neurodesk/webapp-components/styles/imaging-workspace.css";
import { mountImagingWorkspace } from "@neurodesk/webapp-components/core/mount-imaging-workspace";
import {
  StageResultList,
  bindFileDrop,
  createInfoDialog,
  renderConsole,
  renderViewerToolbar,
} from "@neurodesk/webapp-components/ui";
import { APP } from "./config.js";

const $ = (id) => document.getElementById(id);

// 1. Shell: shared app bar, sidebar, viewer and status regions.
const workspace = mountImagingWorkspace({
  controls: "#controls",
  viewer: "#viewer",
  status: "#status",
  title: APP.id,
  subtitle: "Browser-native Neurodesk webapp",
  controlsContract: { about: "#aboutBtn", privacy: "#privacyBtn" },
});

// 2. Viewer chrome: layout tabs above the canvas, technical log below it.
const toolbar = renderViewerToolbar({ window: false, overlay: false, colormap: false, download: false, screenshot: false });
$("viewer").prepend(toolbar.root);
const log = renderConsole({ id: "technicalLog" });
$("viewer").append(log.root);

// 3. Information dialog: About and Privacy open from the shared app bar; Cite comes from the registry.
const info = createInfoDialog();
$("aboutBtn").onclick = () => info.open(`About ${APP.id}`, $("aboutContent"));
$("privacyBtn").onclick = () => info.open("Privacy", $("privacyContent"));

// 4. Workflow: input → run → results. Replace the bodies with the science.
const results = new StageResultList({
  element: $("resultList"),
  onView: (stage) => status(`Viewing ${stage}`),
  onDownload: (stage) => status(`Downloading ${stage}`),
});
let source = null;

function status(message, error = false) {
  $("statusText").textContent = message;
  $("statusText").classList.toggle("error", error);
  log.log(message, error ? "error" : "info");
}

function loadFiles(filesPromise) {
  filesPromise.then((files) => {
    source = files[0] ?? null;
    $("fileInfo").hidden = !source;
    $("fileInfo").textContent = source ? source.name : "";
    $("dropZone").classList.toggle("has-files", Boolean(source));
    $("emptyState").hidden = Boolean(source);
    $("runButton").disabled = !source;
    status(source ? `${source.name} loaded` : "Ready");
  });
}
$("imageInput").addEventListener("change", (event) => {
  const files = Array.from(event.target.files);
  event.target.value = "";
  if (files.length) loadFiles(Promise.resolve(files));
});
bindFileDrop($("dropZone"), loadFiles);
$("exampleButton").addEventListener("click", () => status("Add an example image URL to load here"));

$("runButton").addEventListener("click", () => {
  status("Processing…");
  $("progress").value = 0.5;
  // Run the worker here, then publish outputs:
  results.render({ output: { description: "Processed image" } });
  $("outputSection").open = true;
  $("progress").value = 1;
  status("Processing complete");
});

export default Object.freeze({ workspace, toolbar, log, info, results });
