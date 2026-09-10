import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Ship a real npm tarball: it installs independently of this monorepo.
export function standalonePackage() {
  return {name:'synthsr-standalone-package',apply:'build',async generateBundle(){
    const folder=await mkdtemp(join(tmpdir(),'synthsr-package-'));
    try {
      const cwd=fileURLToPath(new URL('../../../packages/synthsr/',import.meta.url));
      const {stdout}=await promisify(execFile)('npm',['pack','--ignore-scripts','--json','--pack-destination',folder],{cwd});
      const [{filename}]=JSON.parse(stdout);
      this.emitFile({type:'asset',fileName:'downloads/'+filename,source:await readFile(join(folder,filename))});
    } finally {await rm(folder,{recursive:true,force:true});}
  }};
}

export function nativeReleaseVersion() {
  return {name:'synthsr-native-release-version',async config(){
    const cargo=await readFile(fileURLToPath(new URL('../../../exes/synthsr/Cargo.toml',import.meta.url)),'utf8');
    const packageSection=cargo.split('[package]',2)[1]?.split('\n[',1)[0]||'';
    const version=packageSection.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
    if(!version||!/^\d+(?:\.[0-9A-Za-z_-]+)+$/.test(version))throw new Error('SynthSR Cargo package version is missing or invalid.');
    return {define:{__SYNTHSR_NATIVE_VERSION__:JSON.stringify(version)}};
  }};
}
