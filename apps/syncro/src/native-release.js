import {createSyncroRelease} from '../../../packages/syncro/release.mjs';

export const syncroRelease=createSyncroRelease(__SYNCRO_PACKAGE_VERSION__);

function element(root,id) {
  const value=root.querySelector(`#${id}`);
  if(!value)throw new Error(`Missing SYNcro standalone control: ${id}`);
  return value;
}

export function configureNativeDownloads(root,release=syncroRelease) {
  for(const id of ['windows-x64','linux-x64']) {
    const target=release.targets[id],name=id.startsWith('windows')?'Windows':'Linux';
    const link=element(root,`native${name}Download`),checksum=element(root,`native${name}Checksum`);
    link.href=target.url;link.download=target.archiveName;link.textContent=`Download ${target.archiveName}`;
    checksum.href=target.checksumUrl;
    const setup=id.startsWith('windows')
      ?`Expand-Archive -Path .\\${target.archiveName} -DestinationPath .\n${target.selfCheck}\n${target.run}`
      :`curl -fLO ${target.url}\ncurl -fLO ${target.checksumUrl}\nsha256sum -c ${target.checksumName}\ntar -xzf ${target.archiveName}\n${target.selfCheck}\n${target.run}`;
    element(root,`native${name}Commands`).textContent=setup;
  }
  const npm=`neurodesk-syncro-${release.version}.tgz`;
  const npmLink=element(root,'packageLink');
  npmLink.href=`downloads/${npm}`;npmLink.download=true;npmLink.textContent=`Download npm package · ${release.version}`;
  element(root,'downloadCommand').textContent=`curl -fLO https://webapps.neurodesk.org/syncro/downloads/${npm}`;
  element(root,'installCommand').textContent=`ONNXRUNTIME_NODE_INSTALL=skip npm install -g --prefix "$HOME/.local" ./${npm}`;
}
