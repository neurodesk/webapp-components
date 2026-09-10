const RELEASE_ROOT = 'https://github.com/neurodesk/webapps/releases/download';

export function nativeDownloads(version) {
  if (!/^[0-9]+(?:\.[0-9A-Za-z_-]+)+$/.test(version)) throw new Error('Invalid native release version.');
  const base = `${RELEASE_ROOT}/synthsr-v${version}`;
  const item = (filename, setup, command) => ({
    filename,
    url: `${base}/${filename}`,
    checksumUrl: `${base}/${filename}.sha256`,
    setup,
    command,
  });
  const macos = `synthsr-${version}-macos-arm64.pkg`;
  const windows = `synthsr-${version}-windows-x64.zip`;
  const linux = `synthsr-${version}-linux-x64.tar.gz`;
  return {
    macos: item(macos, `open ~/Downloads/${macos}`, 'synthsr input.nii.gz output_synthsr.nii.gz --threads 8'),
    windows: item(
      windows,
      `Expand-Archive .\\${windows} .\\synthsr-windows\nSet-Location .\\synthsr-windows`,
      '.\\synthsr.exe input.nii.gz output_synthsr.nii.gz --threads 8',
    ),
    linux: item(
      linux,
      `curl -fLO ${base}/${linux}\nmkdir -p synthsr-linux && tar -xzf ${linux} -C synthsr-linux\ncd synthsr-linux`,
      './synthsr input.nii.gz output_synthsr.nii.gz --threads 8',
    ),
  };
}

export function configureNativeDownloads(downloads, root) {
  const document = { getElementById: (id) => root.querySelector(`#${id}`) };
  for (const [platform, item] of Object.entries(downloads)) {
    const name = platform[0].toUpperCase() + platform.slice(1);
    const link = document.getElementById(`native${name}Download`);
    const checksum = document.getElementById(`native${name}Checksum`);
    const commands = document.getElementById(`native${name}Commands`);
    if (!link || !checksum || !commands) throw new Error(`Missing native ${platform} download controls.`);
    link.href = item.url;
    link.download = item.filename;
    link.textContent = `Download ${item.filename}`;
    checksum.href = item.checksumUrl;
    commands.textContent = `${item.setup}\n${item.command}`;
  }
}
