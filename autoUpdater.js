/* eslint-disable object-curly-spacing */
var semver = require("semver");
var currVersion = require("./package.json").version;
var syncrequest = require("sync-request");
var childProcess = require("child_process");
var fetch = require("node-fetch");
var fs = require("fs");
var AdmZip = require('adm-zip');
var path = require("path");
var rimraf = require("rimraf");

var pr = semver.prerelease(currVersion);
var gitCheck = childProcess.spawnSync("git", [
    "rev-parse",
    "--is-inside-work-tree"
], {
    shell: true,
    stdio: "pipe",
    cwd: __dirname
});
var gitCheckX = (!gitCheck.error ? gitCheck.stdout.toString("utf8").split(/(\r\n)|(\r)|(\n)/g)[0] == "true" : false);

/**
 * Find every file in a directory
 *
 * @param   {string}    startPath        A path specify where to start.
 * @param   {RegExp}    filter           Regex to filter results.
 * @param   {boolean}   arrayOutput      Options: Output array or send to callback?
 * @param   {boolean}   recursive        Options: Recursive or not?
 * @param   {function}  [callback]       Callback function.
 *
 * @return  {(Array<String>|undefined)}  An array contains path of every files match regex.
 */
function findFromDir(startPath, filter, arrayOutput, recursive, callback) {
    var nocallback = false;
    if (!callback) {
        callback = function () { };
        nocallback = true;
    }
    if (!fs.existsSync(startPath)) {
        throw new Error("No such directory: " + startPath);
    }
    var files = fs.readdirSync(startPath);
    var arrayFile = [];
    for (var i = 0; i < files.length; i++) {
        var filename = path.join(startPath, files[i]);
        var stat = fs.lstatSync(filename);
        if (stat.isDirectory() && recursive) {
            var arrdata = findFromDir(filename, filter, true, true);
            if (!nocallback && !arrayOutput) {
                for (var n in arrdata) {
                    callback(path.join(filename, arrdata[n]));
                }
            } else {
                arrayFile = arrayFile.concat(arrdata);
            }
        } else {
            if (!arrayOutput && !nocallback) {
                if (filter.test(filename)) callback(filename);
            } else {
                if (filter.test(filename)) arrayFile[arrayFile.length] = filename;
            }
        }
    }
    if (arrayOutput && !nocallback) {
        callback(arrayFile);
    } else if (arrayOutput) {
        return arrayFile;
    }
}

/**
 * Ensure <path> exists.
 *
 * @param   {string}  path  Path
 * @param   {number}  mask  Folder's mask
 *
 * @return  {object}        Error or nothing.
 */
function ensureExists(path, mask) {
    if (typeof mask != 'number') {
        mask = 0o777;
    }
    try {
        fs.mkdirSync(path, {
            mode: mask,
            recursive: true
        });
        return null;
    } catch (ex) {
        return { err: ex };
    }
}

module.exports = {
    checkForUpdate: function checkForUpdate(forceStable) {
        if ((Array.isArray(pr) && pr.length >= 1 && (pr[0] == "beta" || pr[0] == "alpha")) && gitCheckX && !forceStable) {
            //Handling the alpha/beta github version
            var currentHash = childProcess.spawnSync("git", [
                "rev-parse",
                "--short",
                "HEAD"
            ], {
                shell: true,
                stdio: "pipe",
                cwd: __dirname
            }).stdout.toString("utf8").replace(/\r/g, "").replace(/\n/g, "");
            if (currentHash == "") {
                return this.checkForUpdate(true);
            }
            try {
                var githubHash = JSON.parse(syncrequest("GET", "https://api.github.com/repos/lequanglam/c3c/git/ref/heads/master", {
                    headers: {
                        "User-Agent": `C3CBot/${currVersion} request/0.0-sync`,
                        "Accept": "application/vnd.github.v3.full+json"
                    }
                }).body.toString()).object.sha.substr(0, 7);
            } catch (ex) {
                return {
                    newUpdate: false,
                    version: `0.0.0-GITHUB-RATELIMITED`,
                    currVersion: `0.0.0-git.${currentHash}`
                }
            }
            return {
                newUpdate: githubHash != currentHash,
                version: `0.0.0-git.${githubHash}`,
                currVersion: `0.0.0-git.${currentHash}`
            }
        } else if (pr == null || forceStable) {
            //Handling stable version
            var githubdata = JSON.parse(syncrequest("GET", "https://api.github.com/repos/lequanglam/c3c/git/refs/tags", {
                headers: {
                    "User-Agent": `C3CBot/${currVersion} request/0.0-sync`,
                    "Accept": "application/vnd.github.v3.full+json"
                }
            }).body.toString());
            try {
                var latestrelease = githubdata[githubdata.length - 1].ref.replace("refs/tags/", "");
            } catch (ex) {
                return {
                    newUpdate: false,
                    version: "0.0.0-GITHUB-RATELIMITED",
                    currVersion: currVersion
                }
            }
            return {
                newUpdate: semver.lt(currVersion, latestrelease),
                version: latestrelease,
                currVersion: currVersion
            }
        } else {
            //Handling custom version?
            return {
                newUpdate: false,
                version: "0.0.0-custom",
                currVersion: currVersion
            }
        }
    },
    installUpdate: function installUpdate() {
        var resolvePromise = function () { };
        var returnPromise = new Promise(resolve => {
            resolvePromise = resolve;
        });
        var latestRelease = "";
        if (gitCheckX) {
            latestRelease = "latest";
            var gitProcess = childProcess.spawn("git", ["stash"], {
                shell: true,
                stdio: "pipe",
                cwd: __dirname
            });
            gitProcess.on("close", function () {
                var gitProcessX = childProcess.spawn("git", ["pull"], {
                    shell: true,
                    stdio: "pipe",
                    cwd: __dirname
                });
                gitProcessX.on("close", function (code) {
                    if (code != 0) {
                        return resolvePromise(false, "GIT-" + code);
                    }
                    fs.unlinkSync("package-lock.json");
                    var npmProcess = childProcess.spawn("npm", ["install"], {
                        shell: true,
                        stdio: "pipe",
                        cwd: __dirname
                    });
                    npmProcess.on("close", function (code) {
                        if (code != 0) {
                            return resolvePromise(false, "NPM-" + code);
                        }
                        resolvePromise(true, "?");
                    });
                });
            });
        } else {
            var githubdata = JSON.parse(syncrequest("GET", "https://api.github.com/repos/lequanglam/c3c/git/refs/tags", {
                headers: {
                    "User-Agent": `C3CBot/${currVersion} request/0.0-sync`,
                    "Accept": "application/vnd.github.v3.full+json"
                }
            }).body.toString());
            try {
                latestRelease = githubdata[githubdata.length - 1].ref.replace("refs/tags/", "");
            } catch (ex) {
                return resolvePromise(false, "GITHUB-RATE-LIMITED.");
            }
            //HTTP ZIP package method
            //var zipDownload = https.get(`https://github.com/lequanglam/c3c/archive/${latestRelease}.zip`);
            fetch(`https://github.com/lequanglam/c3c/archive/${latestRelease}.zip`)
                .then(f => {
                    if (!f.ok) {
                        throw new Error(`HTTP/1.1 ${f.status}`);
                    } else {
                        return f.buffer();
                    }
                })
                .then(buf => {
                    var zip = new AdmZip(buf);
                    zip.extractAllTo(__dirname, true);

                    var fileList = findFromDir(path.join(__dirname, `c3c-${latestRelease}`), /.*/, true, true);
                    var newDir = "";
                    for (var i in fileList) {
                        var fileObj = path.parse(fileList[i]);
                        ensureExists(fileObj.dir, 0o777);
                        newDir = path.resolve(__dirname, path.relative(path.join(__dirname, `c3c-${latestRelease}`), fileList[i]));
                        try {
                            fs.renameSync(fileList[i], newDir);
                        } catch (ex) {
                            //Cannot rename, using write to new files and unlink old files method
                            fs.writeFileSync(newDir, fs.readFileSync(fileList[i]));
                            fs.unlinkSync(fileList[i]);
                        }
                    }
                    //Removing the directory where ZIP files are extracted.
                    rimraf.sync(path.join(__dirname, `c3c-${latestRelease}`));

                    fs.unlinkSync("package-lock.json");
                    var npmProcess = childProcess.spawn("npm", [
                        "--depth", 
                        "9999", 
                        "update"
                    ], {
                        shell: true,
                        stdio: "pipe",
                        cwd: __dirname
                    });
                    npmProcess.on("close", function (code) {
                        if (code != 0) {
                            return resolvePromise(false, "NPM-" + code);
                        }
                        resolvePromise(true, zip.getEntryCount());
                    });
                })
                .catch(err => {
                    resolvePromise(false, `Error: ${err}`);
                });
        }
        return returnPromise;
    }
}
