export function arrayBufferToFile(buffer, name, type = 'application/octet-stream') {
  return new File([new Blob([buffer], { type })], name, { type });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on a later macrotask: Safari/WebKit can drop the download if the blob
  // URL is revoked before the fetch is queued, notably on back-to-back downloads.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadFile(file) {
  downloadBlob(file, file.name);
}

export function downloadArrayBuffer(buffer, filename, type = 'application/octet-stream') {
  downloadBlob(new Blob([buffer], { type }), filename);
}
