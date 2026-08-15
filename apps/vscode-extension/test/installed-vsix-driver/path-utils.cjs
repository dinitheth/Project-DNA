function normalizeFilesystemPath(filePath, platform = process.platform) {
  if (platform !== 'win32' || !/^[A-Za-z]:/.test(filePath)) return filePath;
  return `${filePath[0].toLowerCase()}${filePath.slice(1)}`;
}

function sameFilesystemPath(actual, expected, platform = process.platform) {
  return (
    normalizeFilesystemPath(actual, platform) === normalizeFilesystemPath(expected, platform)
  );
}

exports.normalizeFilesystemPath = normalizeFilesystemPath;
exports.sameFilesystemPath = sameFilesystemPath;
