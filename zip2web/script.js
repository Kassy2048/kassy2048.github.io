// XXX document.currentScript is not available in event handlers
const baseUrl = new URL(document.currentScript.src).href.replace(/\/[^\/]+$/, '');

/** Stream files bigger than MIN_STREAM_SIZE.
 * (needed for video to start playing sooner)
 */
const MIN_STREAM_SIZE = 10 * 1024 * 1024;  // 10 MB

document.addEventListener('DOMContentLoaded', () => {
    const howto = document.querySelector('.howto');
    const fileLabel = document.getElementById('file-label');
    const fileInput = document.getElementById('file');
    const browseFiles = document.getElementById('browse-files');
    const openFolder = document.getElementById('open-folder');
    const debugMode = document.getElementById('debug-mode');
    const addFullscreen = document.getElementById('add-fullscreen');
    const progress = document.querySelector('#progress');  // TODEL?
    const progressBar = document.querySelector('#progress .value');  // TODEL?
    const dropzone = document.getElementById('dropzone');
    const playframe = document.getElementById('playframe');
    const errorDiv = document.getElementById('errordiv');

    howto.style.display = 'revert';

    function debugLog(...args) {
        if(!debugMode.checked) return;
        console.debug(...args);
    }

    function showError(msg) {
        errorDiv.innerHTML = `----- ERROR -----<br/>${msg}`;
    }

    function htmlEscape(txt) {
        const div = document.createElement('div');
        div.textContent = txt;
        return div.innerHTML;
    }

    function sizeStr(size) {
        if(size < 1024) return size + 'B';
        size = Math.round(size / 1024);
        if(size < 1024) return size + 'K';
        size = Math.round(size / 1024);
        if(size < 1024) return size + 'M';
        size = Math.round(size / 1024);
        if(size < 1024) return size + 'G';
        size = Math.round(size / 1024);
        return size + 'T';
    }

    function pad0(val, size) {
        val = '' + val;
        while(val.length < size) val = '0' + val;
        return val;
    }

    function dateStr(date) {
        // YYYY-MM-DD HH:MM:SS
        return pad0(date.getFullYear(), 4) + '-' + pad0(date.getMonth() + 1, 2)
                + '-' + pad0(date.getDate(), 2) + ' ' + pad0(date.getHours(), 2) + ':'
                + pad0(date.getMinutes(), 2) + ':'+ pad0(date.getSeconds(), 2);
    }

    window.convertProgress = function(full_progress, task, task_progress, task_total) {
        const percent = Math.floor(full_progress * 100.0);
        let label = percent + '%';
        if(task !== undefined) {
            label += ' - ' + task;
            if(task_progress > -1 && task_total !== undefined) {
                label += ` (${task_progress} / ${task_total})`;
            }
        }

        progress.dataset.label = label;
        progressBar.style.width = percent + '%';
    };

    let busy = false;
    let zipFs = null;
    let password = '';
    let zipFilename = null;

    const htmlRE = /\.html?$/i;
    const indexRE = /^index\.html?$/i;

    if(zip?.configure === undefined) {
        showError('Failed to load the zip.js library');
    } else if(window.DecompressionStream === undefined) {
        console.warn('Compression Streams not supported');
        zip.configure({useCompressionStream: false});
    }

    fileInput.addEventListener('change', async (e) => {
        debugLog(e);

        await handleFiles(fileInput.files);
    });

    async function handleFiles(files, isDirectory, filePaths) {
        if(isDirectory === undefined) isDirectory = openFolder.checked;

        if(busy) return;

        if(files.length == 0) return;  // Happens on cancel
        if(files.length > 1 && !isDirectory) {
            alert("Only select one file.");
            return;
        }

        busy = true;
        fileInput.disabled = true;
        browseFiles.disabled = true;
        errorDiv.innerHTML = '';

        const start = performance.now();

        try {
            if(isDirectory) {
                await openLocalFolder(files, filePaths);
            } else {
                const file = files[0];
                //TODEL if(!file.name.toLowerCase().endsWith('.zip')) {
                //TODEL     alert("Only select ZIP files.");
                //TODEL     return;
                //TODEL }
                await openFile(file);
            }

            window._zipFs = zipFs;  // DEBUG

            /* Return the only HTML file in root folder if any, or the only index HTML file if any
             * If there is only a single directory entry in the root folder, use it as new root
             */
            function findStartPath(root, path) {
                if(root.children.length == 1 && root.children[0].directory) {
                    const subfolder = root.children[0];
                    return findStartPath(subfolder, path + '/' + subfolder.name);
                }

                let htmlFiles = new Set();
                let indexFiles = new Set();
                root.children.forEach((child) => {
                    if(child.directory) return;
                    if(!htmlRE.test(child.name)) return;

                    htmlFiles.add(child.name);
                    if(indexRE.test(child.name)) indexFiles.add(child.name);
                });

                if(htmlFiles.size == 1) {
                    return path + '/' + htmlFiles.values().next().value;
                }

                if(indexFiles.size == 1) {
                    return path + '/' + indexFiles.values().next().value;
                }

                // Cannot decide what file to open, let the user decide
                return path;
            }

            let startPath = '';
            if(!browseFiles.checked) startPath = findStartPath(zipFs.root, startPath);

            debugLog(`startPath=${startPath}`);

            if(serviceWorker === undefined) {
                convertProgress(0.66, 'Setting up service worker...');
                serviceWorker = await setupServiceWorker();
            }

            convertProgress(1.0, `Done in ${Math.round((performance.now() - start) / 1000)} seconds`);

            // Open iframe with content in it
            playframe.src = playBaseUrl + startPath;
            playframe.style.display = 'block';

        } catch(e) {
            console.error(e);
            showError(e);

        } finally {
            fileInput.disabled = false;
            browseFiles.disabled = false;
            busy = false;
        }
    }

    async function openFile(file) {
        zipFilename = file.name;

        convertProgress(0, 'Opening ZIP file...');

        zipFs = new zip.fs.FS();
        zipFs.isLocalDir = false;
        await zipFs.importBlob(file);

        convertProgress(0.33, 'Parsing ZIP file...');

        if(zipFs.isPasswordProtected()) {
            let first = true;
            let promptMsg = 'File is password protected, please enter password:';
            while(true) {
                const ret = prompt(promptMsg, password);
                if(ret === null) {
                    showError('File is password protected.');
                    return;
                }

                password = ret;

                if(await zipFs.checkPassword(password)) break;

                if(first) {
                    first = false;
                    promptMsg = 'Bad password.\n\n' + promptMsg;
                }
            }
        }
    }

    async function openLocalFolder(files, filePaths) {
        zipFilename = null;

        convertProgress(0, 'Listing files...');

        class Directory {
            constructor(name, parent) {
                this.name = name;  // optional for root folder
                this.parent = parent;  // optional for root folder
                this.entries = {};

                // ZipFS interface
                this.directory = true;
                this.children = [];
            }

            getEntry(name) {
                const entry = this.entries[name];
                return entry === undefined ? null : entry;
            }

            addEntry(name, item, _noCheck) {
                if(!!!_noCheck && this.entries[name] !== undefined) {
                    throw new Error(`"${name}" already in ${this.name}`);
                }

                this.entries[name] = item;
                this.children.push(item);
            }

            get path() {
                if(this.parent !== undefined) {
                    return this.parent.path + '/' + this.name;
                } else {
                    // Root folder
                    return '';
                }
            }
        }

        class File {
            constructor(name, handle, parent) {
                this.name = name;
                this.handle = handle;
                this.parent = parent;

                // ZipFS interface
                this.directory = false;
                this.uncompressedSize = handle.size;
                this.data = {
                    uncompressedSize: handle.size,
                    lastModDate: new Date(handle.lastModified),
                };
            }

            get path() {
                return this.parent.path + '/' + this.name;
            }

            // ZipFS interface

            async getText(encoding, options) {
                // Only UTF-8 is supported
                return await this.handle.text();
            }

            async getUint8Array(options) {
                const buffer = await this.handle.arrayBuffer();
                return new Uint8Array(buffer);
            }
        }

        const root = new Directory();

        function addFile(fileHandle, baseFolder, path) {
            if(path.length != 1) {
                const folderName = path[0];
                let folder = baseFolder.getEntry(folderName);
                if(folder === null) {
                    folder = new Directory(folderName, baseFolder);
                    baseFolder.addEntry(folderName, folder, true);
                }
                return addFile(fileHandle, folder, path.slice(1));
            }

            const fileName = path[0];
            const file = new File(fileName, fileHandle, baseFolder);
            baseFolder.addEntry(fileName, file);
        }

        for(let i = 0 ; i < files.length ; ++i) {
            const fileHandle = files[i];
            let path = filePaths !== undefined ? filePaths[i]
                    : fileHandle.webkitRelativePath;

            if(path.startsWith('/')) path = path.slice(1);

            addFile(fileHandle, root, path.split('/'));
        }

        // Create a ZipFS compatible object
        zipFs = {
            root: root,
            isLocalDir: true,
        };
    }

    function onOpenFolderChange(e) {
        if(openFolder.checked) {
            // Select a local folder instead of a file
            fileInput.webkitdirectory = true;
            fileLabel.textContent = 'Local Folder';
        } else {
            fileInput.webkitdirectory = false;
            fileLabel.textContent = 'ZIP File';
        }
    }

    openFolder.addEventListener('change', onOpenFolderChange);

    // Drag'n'drop

    function dnd_files(e) {
        let files = [];
        if(e.dataTransfer.items) {
            // Use DataTransferItemList interface to access the file(s)
            [...e.dataTransfer.items].forEach((item, i) => {
                // If dropped items aren't files, reject them
                if (item.kind === "file") {
                    if(item.webkitGetAsEntry !== undefined) {
                        const entry = item.webkitGetAsEntry();
                        if(entry !== null && entry.isDirectory) {
                            // Add the directory to visit later
                            files.push(entry);
                            return;  // Do not continue
                        }
                    }

                    files.push(item.getAsFile());
                }
            });
        } else {
            // Use DataTransfer interface to access the file(s)
            [...ev.dataTransfer.files].forEach((file, i) => {
                files.push(file);
            });
        }
        return files;
    }

    document.addEventListener('drop', async (e) => {
        dropzone.style.display = 'none';

        e.preventDefault();
        debugLog(e);

        if(busy) return;

        const files = dnd_files(e);
        if(files.length == 0) {
            alert("Only drag files on this page.");
            return;
        }
        if(files.length > 1) {
            alert("Only drag one file on this page.");
            return;
        }

        const file = files[0];
        if(file instanceof File) {
            // A single file (File)

            //TODEL if(!file.name.toLowerCase().endsWith('.zip')) {
            //TODEL     alert("Only drag ZIP files on this page.");
            //TODEL     return;
            //TODEL }

            // Replace input file value with this file (this does not trigger the "change" event)
            const dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;

            handleFiles([file], false);

        } else {
            // A directory (FileSystemDirectoryEntry)
            const allFiles = [];
            const filePaths = [];

            async function visitFolder(folder) {
                while(true) {
                    const results = await new Promise((resolve, reject) => {
                        folder.readEntries(resolve, reject);
                    });

                    if(!results.length) break;

                    for(const entry of results) {
                        if(entry.isDirectory) {
                            await visitFolder(entry.createReader());
                        } else if(entry.isFile) {
                            // Add it to allFiles
                            const file = await new Promise((resolve, reject) => {
                                entry.file(resolve, reject);
                            });

                            allFiles.push(file);
                            // webkitRelativePath is always empty here...
                            filePaths.push(entry.fullPath);
                        }
                    }
                }
            }

            await visitFolder(file.createReader());

            handleFiles(allFiles, true, filePaths);
        }
    });

    document.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    // Show/hide drop zone based on dragging
    document.addEventListener('dragenter', (e) => {
        if(busy) return;
        if(e.relatedTarget === null) {
            dropzone.style.display = 'inherit';
        }
    });
    document.addEventListener('dragleave', (e) => {
        if(busy) return;
        if(e.relatedTarget === null) {
            dropzone.style.display = 'none';
        }
    });

    // Service worker

    let serviceWorker;
    let pageId;
    let playBaseUrl;
    const indexStyleUrl = baseUrl + '/indexStyle.css';
    const hookScriptUrl = baseUrl + '/zip2web-extra.js';

    if(navigator.serviceWorker === undefined) {
        fileInput.disabled = true;
        browseFiles.disabled = true;
        busy = true;

        showError('Service Worker is not supported by your browser.<br/><br/>'
                + 'Firefox will not work in private mode.<br/>'
                + 'Chrome/Edge will work in both normal and incognito modes.');

        return;
    }

    function setupServiceWorker() {
        return new Promise((resolve, reject) => {
            navigator.serviceWorker
                .register("service-worker.js")
                .then((registration) => {
                    let serviceWorker;
                    if(registration.installing) {
                        serviceWorker = registration.installing;
                        debugLog('installing');
                    }
                    if(registration.waiting) {
                        serviceWorker = registration.waiting;
                        debugLog('waiting');
                    }
                    if(registration.active) {
                        serviceWorker = registration.active;
                        debugLog('active');
                    }

                    if(serviceWorker) {
                        debugLog('state', serviceWorker.state);
                        if(serviceWorker.state == 'activated') {
                            onServiceWorkerReady(serviceWorker);
                        } else {
                            serviceWorker.addEventListener("statechange", (e) => {
                                debugLog('statechange', e.target.state);
                                if(serviceWorker.state == 'activated') {
                                    onServiceWorkerReady(serviceWorker);
                                }
                            });
                        }
                    }
                })
                //.catch((error) => {  // TODO Show error to user (or call reject)
                //});

            // XXX Using navigator.serviceWorker.ready does not work because this script/page is not
            //     located under ./play/
            // FIXME That's not true anymore now that the scope is ./
            function onServiceWorkerReady(serviceWorker) {
                debugLog('ready', serviceWorker);

                navigator.serviceWorker.addEventListener('message', async (e) => {
                    // https://developer.mozilla.org/en-US/docs/Web/API/Client/postMessage
                    debugLog('serviceWorker.message', e);
                    const msg = e.data;
                    switch(msg.name) {
                        case 'getPageId-resp':
                            pageId = msg.pageId;
                            onPageIdReady(serviceWorker);
                            break;

                        case 'getFile':
                            // Fetch file from zip file
                            try {
                                let parts = msg.path.split('/');
                                let root = zipFs.root;
                                let replaced = false;
                                while(parts.length > 0) {
                                    if(parts[0].length > '') {
                                        // const child = root.getChildByName(parts[0]);
                                        // Try to find the children, ignoring the case if needed
                                        let child, maybeChild, partLower = parts[0].toLowerCase();
                                        for(let i = 0 ; i < root.children.length ; ++i) {
                                            if(root.children[i].name.toLowerCase() == partLower) {
                                                // Record non-exact match
                                                maybeChild = root.children[i];
                                                if(root.children[i].name == parts[0]) {
                                                    // Exact match found
                                                    child = root.children[i];
                                                    break;
                                                }
                                            }
                                        }
                                        if(child === undefined) {
                                            if(maybeChild !== undefined) replaced = true;
                                            child = maybeChild;
                                        }
                                        if(child === undefined) throw new Error("Not Found");
                                        root = child;
                                    }
                                    parts = parts.slice(1);
                                }

                                if(replaced) {
                                    console.warn(`Replacing not found entry "${msg.path}" with "${root.data.filename}"`);
                                }

                                if(!browseFiles.checked && root.directory) {
                                    // Look for index.htm(l) and return that instead
                                    let indexFile = null;
                                    root.children.forEach((child) => {
                                        if(child.directory) return;
                                        if(indexRE.test(child.name)) indexFile = child;
                                    });
                                    if(indexFile !== null) root = indexFile;
                                }

                                if(root.directory) {
                                    if(msg.path.length == 0) msg.path = '/';
                                    if(!msg.path.endsWith('/')) {
                                        // Force the URL to end with '/' to make relative links work
                                        serviceWorker.postMessage({name: 'getFile-resp',
                                                path: msg.path, id: msg.id, content: '', headers: {
                                                    'Location': baseUrl + '/' + playBaseUrl + msg.path + '/',
                                                }, status: 301});
                                        return;
                                    }

                                    // Build an HTML page with the list of files in that directory
                                    let folders = [];
                                    let files = [];
                                    root.children.forEach((child) => {
                                        if(child.directory) folders.push(child);
                                        else files.push(child);
                                    });

                                    folders.sort((a, b) => a.name.localeCompare(b.name));
                                    files.sort((a, b) => a.name.localeCompare(b.name));

                                    let title = `Index of ${htmlEscape(msg.path)}`;
                                    if(zipFilename !== null) title += `(from ${htmlEscape(zipFilename)})`;

                                    let html = '<!DOCTYPE html><html><head>'
                                            + '<title>' + title +'</title>'
                                            + '<meta charset="utf-8">'
                                            + `<link href="${indexStyleUrl}" rel="stylesheet" />`
                                            + '</head><body><h1>' + title + '</h1>'
                                            + '<div class="entry-list"><table>'
                                            + '<tr><th></th><th>Name</th><th>Size</th><th>Last modified</th></tr>';

                                    if(root !== zipFs.root) {
                                        html += '<tr>'
                                                + '<td>&#x1F53C;</td>'
                                                + '<td><a href="../">Parent Directory</a></td>'
                                                + '<td>-</td><td>-</td></tr>';
                                    }

                                    folders.forEach((folder) => {
                                        html += '<tr>'
                                                + '<td>&#x1F4C1;</td>'
                                                + `<td><a href="${encodeURIComponent(folder.name)}/">${htmlEscape(folder.name)}/</a></td>`
                                                + '<td>-</td><td>-</td></tr>';
                                    });

                                    files.forEach((file) => {
                                        html += '<tr>'
                                                + '<td>&#x1F4C4;</td>'
                                                + `<td><a href="${encodeURIComponent(file.name)}">${htmlEscape(file.name)}</a></td>`
                                                + `<td>${sizeStr(file.data.uncompressedSize)}</td>`
                                                + `<td>${dateStr(file.data.lastModDate)}</td>`
                                                + '</tr>';
                                    });

                                    html += '</table></div></body></html>';

                                    serviceWorker.postMessage({name: 'getFile-resp',
                                            path: msg.path, id: msg.id, content: html, headers: {
                                                'Content-Type': 'text/html',
                                            }});

                                } else if(addFullscreen.checked && htmlRE.test(root.name)) {
                                    // Inject our script to add the fullscreen button
                                    let html = await root.getText('utf-8', {'password': password});
                                    const options = btoa(JSON.stringify({
                                        addFullscreen: addFullscreen.checked,
                                    }));
                                    // XXX This can fail in multiple ways, but should work most of the time
                                    html = html.replace(/(<\/\s*head\s*>)/i,
                                            `\n<script src="${hookScriptUrl}" data-options="${options}"></script>\n$1`);
                                    serviceWorker.postMessage({name: 'getFile-resp',
                                            path: msg.path, id: msg.id, content: html, headers: {
                                                'Content-Type': zip.getMimeType(root.name),
                                            }});

                                } else {
                                    const fileSize = root.uncompressedSize;
                                    const resp = {
                                        name: 'getFile-resp',
                                        path: msg.path,
                                        id: msg.id,
                                        headers: {
                                            'Content-Type': zip.getMimeType(root.name),
                                            'Content-Length': fileSize,
                                        },
                                    };
                                    const transfer = [];

                                    if(!zipFs.isLocalDir && fileSize >= MIN_STREAM_SIZE) {
                                        // Stream the file content
                                        const {readable, writable} = new TransformStream();
                                        root.getWritable(writable, {'password': password});
                                        resp.stream = readable;
                                        transfer.push(readable);
                                    } else {
                                        // Decompress the file at once
                                        const content = await root.getUint8Array({'password': password});
                                        resp.content = content;
                                        transfer.push(content.buffer);
                                    }

                                    serviceWorker.postMessage(resp, transfer);
                                }
                            } catch(error) {
                                console.warn(msg.path, error);
                                serviceWorker.postMessage({name: 'getFile-resp', path: msg.path, id: msg.id, error: 404});
                            }
                            break;

                        case 'error':
                            console.error('Error from service worker', msg.text);
                            break;

                        default:
                            console.error('Invalid message from service worker', e);
                    }
                });

                serviceWorker.postMessage({name: 'setDebug', enabled: debugMode.checked});
                serviceWorker.postMessage({name: 'getPageId'});
            }

            function onPageIdReady(serviceWorker) {
                playBaseUrl = 'play/' + encodeURIComponent(pageId) + '/';
                resolve(serviceWorker);
            }
        });
    }

    playframe.addEventListener('load', (e) => {
        // Replace window title with the iframe title
        document.title = playframe.contentDocument.title;
    });

    playframe.addEventListener('error', (e) => {
        console.error('Failed to load iframe', e);
        alert('Error while loading the game');
    });

    // Persist settings

    if(window.localStorage !== undefined) {
        function getLocal(name, def_val) {
            const value = window.localStorage[name];
            return value === undefined ? def_val : value;
        }

        browseFiles.checked = getLocal('zip2web-browseFiles', 'false') == 'true';
        openFolder.checked = getLocal('zip2web-openFolder', 'false') == 'true';
        debugMode.checked = getLocal('zip2web-debugMode', 'false') == 'true';
        addFullscreen.checked = getLocal('zip2web-addFullscreen', 'false') == 'true';

        browseFiles.addEventListener('change', (e) => {
            window.localStorage['zip2web-browseFiles'] = e.target.checked;
        });
        openFolder.addEventListener('change', (e) => {
            window.localStorage['zip2web-openFolder'] = e.target.checked;
        });
        debugMode.addEventListener('change', (e) => {
            window.localStorage['zip2web-debugMode'] = e.target.checked;
        });
        addFullscreen.addEventListener('change', (e) => {
            window.localStorage['zip2web-addFullscreen'] = e.target.checked;
        });

        onOpenFolderChange();
    }
});
