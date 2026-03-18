import { URI } from 'vscode-uri';
import * as tmp from 'tmp';
import fetch from 'node-fetch';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'fs';
import * as mime from 'mime-types';
import { copyFile } from './fileutil';
import { replaceCurrentColorInFileContent } from './currentColorHelper';

tmp.setGracefulCleanup();

let imageCache: Map<String, Thenable<string>> = new Map();
let currentColor: string;
let storagePath: string;
export const ImageCache = {
    configure: (clientStoragePath) => {
        storagePath = clientStoragePath;
    },
    setCurrentColor: (color: string) => {
        if (currentColor != color) {
            currentColor = color;
            imageCache.clear();
        }
    },
    delete: (key: string) => {
        imageCache.get(key).then((tmpFile) => fs.unlink(tmpFile, () => {}));
        imageCache.delete(key);
    },
    set: (key: string, value: Thenable<string>) => {
        imageCache.delete(key);
        imageCache.set(key, value);
    },
    get: (key: string) => {
        return imageCache.get(key);
    },
    has: (key: string) => {
        return imageCache.has(key);
    },
    store: (absoluteImagePath: string): Thenable<string> => {
        const currentColorForClojure: string = currentColor;
        if (ImageCache.has(absoluteImagePath)) {
            return ImageCache.get(absoluteImagePath);
        } else {
            try {
                const absoluteImageUrl = URI.parse(absoluteImagePath);
                if (!fs.existsSync(storagePath)) {
                    fs.mkdirSync(storagePath);
                }

                const urlExt = absoluteImageUrl.path ? path.parse(absoluteImageUrl.path).ext : '';

                const promise = new Promise<string>((resolve, reject) => {
                    if (absoluteImageUrl.scheme && absoluteImageUrl.scheme.startsWith('http')) {
                        fetch(new url.URL(absoluteImagePath).toString(), {
                            size: 20 * 1024 * 1024, // 20 MB
                        })
                            .then((resp) => {
                                if (!resp.ok) {
                                    reject(resp.statusText);
                                    return;
                                }

                                let tempFile: tmp.FileResult;

                                if (urlExt) {
                                    tempFile = tmp.fileSync({
                                        tmpdir: storagePath,
                                        postfix: urlExt,
                                    });
                                } else {
                                    const contentType = resp.headers.get('content-type') || '';
                                    const inferredExt = contentType ? mime.extension(contentType) : false;

                                    tempFile = tmp.fileSync({
                                        tmpdir: storagePath,
                                        postfix: inferredExt ? `.${inferredExt}` : '',
                                    });
                                }

                                const filePath = tempFile.name;

                                const dest = fs.createWriteStream(filePath);
                                resp.body.pipe(dest);
                                resp.body.on('error', (err) => reject(err));
                                dest.on('finish', () => resolve(filePath));
                            })
                            .catch((err) => reject(err));
                    } else {
                        const tempFile = tmp.fileSync({
                            tmpdir: storagePath,
                            postfix: urlExt || '.png',
                        });

                        const filePath = tempFile.name;

                        try {
                            const handle = fs.watch(absoluteImagePath, function fileChangeListener() {
                                handle.close();
                                fs.unlink(filePath, () => {});
                                ImageCache.delete(absoluteImagePath);
                            });
                        } catch {}

                        copyFile(absoluteImagePath, filePath, (err) => {
                            if (!err) {
                                resolve(filePath);
                            } else {
                                reject(err);
                            }
                        });
                    }
                });
                const injected = promise.then((p) => replaceCurrentColorInFileContent(p, currentColorForClojure));
                ImageCache.set(absoluteImagePath, injected);
                return injected;
            } catch (error) {
                return Promise.reject(error);
            }
        }
    },

    cleanup: () => {
        imageCache.forEach((value) => {
            value.then((tmpFile) => fs.unlink(tmpFile, () => {}));
        });
        imageCache.clear();
    },
};
