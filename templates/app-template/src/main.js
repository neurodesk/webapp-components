import "@neurodesk/webapp-components/styles/imaging-workspace.css";
import { mountImagingWorkspace } from "@neurodesk/webapp-components/core/mount-imaging-workspace";
import { ConsoleOutput, ProgressManager, renderSidebarSection } from "@neurodesk/webapp-components/ui";
import { APP } from "./config.js";

const workspace = mountImagingWorkspace({
  controls: "#controls",
  viewer: "#viewer",
  status: "#status",
  title: APP.id,
  subtitle: "Browser-native Neurodesk webapp",
});
const controls = document.getElementById("controls");
controls.append(
  renderSidebarSection({ title: "Run", content: document.getElementById("runButton") }).root,
  renderSidebarSection({ title: "Advanced settings", collapsed: true, content: "Use the defaults to start." }).root,
);
const progress = new ProgressManager({
  barElement: document.getElementById("progressBar"),
  textElement: document.getElementById("statusText"),
});
const output = new ConsoleOutput({ element: document.getElementById("consoleOutput") });
progress.reset();
output.log(`${APP.id} ready`);

// Keep scientific worker messages, tensor policy, metrics, and pipeline definitions in the app.

export default Object.freeze({ workspace, progress, console: output });
