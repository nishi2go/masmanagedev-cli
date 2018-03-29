var log = require('./logger');
var fs = require('fs-extra');
var templates = require('./templates');
var dbcscripts = require('./dbcscripts');
var env = require('./env');
var path = require('path');
var util = require('util');
var shell = require('shelljs');
var log = require("./logger");

/** 
 * The uuid v4 will be used to replace the uuid property in order to generate the unique id for this PSI package. 
 * TODO: Replace the variable in the right place.
 */
const uuidv4 = require('uuid/v4'); 
uuidv4();


var psi = module.exports = Object.create({});

/**
 * Install and verify the variable from MBO.
 * @param {*} template Template's source folder.
 * @param {*} dir Target directory.
 * @param {*} templateArgs Template's arguments.
 */
psi.installTemplatePSI = function(template, dir, templateArgs) {
  dir = dir || env.addonDir() || '.';
  env.ensureDir(dir);

  if (!templateArgs.mbo_name_lower) {
     templateArgs.mbo_name_lower = templateArgs.mbo_name.toLowerCase();
  }

  if (!templateArgs.java_package_dir) {
     templateArgs.java_package_dir = path.join(...templateArgs.java_package.split('.'));
  }


  log.info("Install %s into %s", template, dir);
  var tdir = templates.resolveName(template);
  shell.ls("-R", tdir).forEach(function(f) {
    if (!fs.lstatSync(path.join(tdir, f)).isDirectory()) {
      psi.installTemplateMboFile(path.resolve(tdir, f), dir, f, templateArgs);
    }
  });
};

/**
 * Handle the PSI template files. 
 * @param {*} template Source folder of template files.
 * @param {*} outBaseDir Output folder name.
 * @param {*} filePath Full path of rendered files.
 * @param {*} templateArgs Template arguments.
 */
psi.installTemplatePSIFile = function(template, outBaseDir, filePath, templateArgs) {
  var destPath = templates.render(filePath, templateArgs);
 
  // handle dbc scripts
  var script = dbcscripts.script(path.basename(template));
  if (script) {
    var destScript = dbcscripts.nextScript(path.join(outBaseDir, path.dirname(destPath)), script.ext);
    destPath = path.join(path.dirname(destPath), destScript);
    log.info("Installing DBC File for psi: %s", destPath);
    templates.renderToFile(template, templateArgs, path.join(outBaseDir, destPath));
    return;
  } //Ending DBC installing process for psi

  log.info("PSI structure installing at: %s", destPath);
  templates.renderToFile(template, templateArgs, path.join(outBaseDir, destPath));
};


function pkgToDir(pkg) {
  pkg = pkg.replace(/\./g, '/');
  return pkg;
}