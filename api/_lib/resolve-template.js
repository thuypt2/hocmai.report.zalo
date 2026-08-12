// Shared utility: resolve template file path to actual HTML content
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

/**
 * Check if htmlBody is a file path (e.g., C:\...\file.txt) and resolve it to actual content.
 * Returns the original htmlBody if it's not a path or if the file can't be read.
 */
function resolveTemplateContent(htmlBody) {
  if (!htmlBody || typeof htmlBody !== 'string') return htmlBody || '';

  // Detect file path: contains backslash or forward slash, or ends with .txt
  const isFilePath = /[\\\\/]/.test(htmlBody) || htmlBody.endsWith('.txt');

  if (!isFilePath) return htmlBody;

  // Split theo cả \ và / (path Windows trong sheet, runtime Linux trên Vercel)
  const filename = htmlBody.replace(/[\\/]+/g, '/').split('/').pop();
  const filePath = path.join(TEMPLATES_DIR, filename);

  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    console.warn('Template file not found:', filePath);
  } catch (e) {
    console.error('Error reading template file:', filePath, e.message);
  }

  return htmlBody; // fallback to original
}

module.exports = { resolveTemplateContent };