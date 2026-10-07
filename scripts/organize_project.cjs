const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(ROOT_DIR, 'tests');
const SCRIPTS_DIR = path.join(ROOT_DIR, 'scripts');

// Ensure directories exist
if (!fs.existsSync(TESTS_DIR)) fs.mkdirSync(TESTS_DIR);
if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR);

const moveMap = [
  { pattern: /^test[-_].*\.(mjs|cjs|js)$/, target: TESTS_DIR },
  { pattern: /^(start|check|deploy|optimize|verify|benchmark|debug|teach)[-_].*\.(mjs|cjs|js)$/, target: SCRIPTS_DIR },
];

// Directories that need parent reference adjustment when moved
const CORE_DIRS = ['arbiters', 'core', 'cluster', 'cognitive', 'config', 'transmitters', 'workers', 'utils', 'src', 'data'];

function updateImports(content) {
  let newContent = content;

  // Fix ES6 imports: import ... from './dir/...' -> from '../dir/...' 
  // Fix CommonJS requires: require('./dir/...') -> require('../dir/...')
  // Fix dotenv: path: './config/...' -> path: '../config/...' 

  CORE_DIRS.forEach(dir => {
    // Match: from './dir/' or from "./dir/"
    // String literal needs double backslash for dot: \\.
    const regexES6 = new RegExp(`from ['"]\\.\\/${dir}\\/`, 'g');
    
    // Match: require('./dir/') or require("./dir/")
    // Open parenthesis ( needs escaping: \\(
    const regexCJS = new RegExp(`require\\(['"]\\.\\/${dir}\\/`, 'g');
    
    newContent = newContent.replace(regexES6, `from '../${dir}/`);
    newContent = newContent.replace(regexCJS, `require('../${dir}/`);
  });

  // Specific fix for dotenv
  newContent = newContent.replace(/path:\s*['"]\.\/config\//g, "path: '../config/");
  // Specific fix for .env in root
  newContent = newContent.replace(/path:\s*['"]\.\/\.env['"]/g, "path: '../.env'");

  // Fix other relative imports that might be just './File.js' if that file remains in root?
  // Most moved files import from subdirectories.
  // If a file imports './SomeFileInRoot.js', and both move to scripts, it should remain './'.
  // But if one stays in root, it should become '../'.
  // This is complex. We'll stick to the core directories which we know are folders.

  return newContent;
}

function organize() {
  const files = fs.readdirSync(ROOT_DIR);
  let movedCount = 0;

  files.forEach(file => {
    const filePath = path.join(ROOT_DIR, file);
    if (!fs.lstatSync(filePath).isFile()) return;

    // Skip this script if it was in root (it's not)
    if (file === 'organize_project.cjs') return;

    let targetDir = null;

    for (const entry of moveMap) {
      if (entry.pattern.test(file)) {
        targetDir = entry.target;
        break;
      }
    }

    if (targetDir) {
      const content = fs.readFileSync(filePath, 'utf8');
      const newContent = updateImports(content);
      const targetPath = path.join(targetDir, file);

      console.log(`Moving ${file} -> ${path.relative(ROOT_DIR, targetPath)}`);
      
      fs.writeFileSync(targetPath, newContent);
      fs.unlinkSync(filePath); // Delete original
      movedCount++;
    }
  });

  console.log(`\nMoved ${movedCount} files.`);
}

organize();
