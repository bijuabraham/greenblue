// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as Y from 'yjs';
import { diffChars } from 'diff'; // Add this at the top if using the 'diff' package

const colorFilePath = path.join(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
    'green_blue-colors.json'
);

function getOrCreateYDoc(fileKey: string): Y.Doc {
    let ydoc: Y.Doc;
    if (fs.existsSync(colorFilePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(colorFilePath, 'utf8'));
            if (data[fileKey]) {
                ydoc = new Y.Doc();
                Y.applyUpdate(ydoc, Buffer.from(data[fileKey], 'base64'));
                return ydoc;
            }
        } catch {}
    }
    ydoc = new Y.Doc();
    ydoc.getArray('chars'); // initialize
    return ydoc;
}

function saveYDoc(fileKey: string, ydoc: Y.Doc) {
    let data: any = {};
    if (fs.existsSync(colorFilePath)) {
        try {
            data = JSON.parse(fs.readFileSync(colorFilePath, 'utf8'));
        } catch {}
    }
    data[fileKey] = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('base64');
    fs.writeFileSync(colorFilePath, JSON.stringify(data, null, 2));
}

export function activate(context: vscode.ExtensionContext) {
    const legend = new vscode.SemanticTokensLegend(['blue', 'green']);

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            try {
                const document = event.document;
                const fileKey = document.uri.fsPath;
                const text = document.getText();

                // Load or create Yjs doc
                const ydoc = getOrCreateYDoc(fileKey);
                const yarr = ydoc.getArray<any>('chars');

                // Apply each change in reverse order (to keep offsets correct)
                [...event.contentChanges].reverse().forEach(change => {
                    const start = document.offsetAt(change.range.start);
                    const end = document.offsetAt(change.range.end);
                    const removed = end - start;
                    const inserted = change.text.length;

                    // Remove deleted chars
                    if (removed > 0) {
                        yarr.delete(start, removed);
                    }
                    // Insert new chars
                    if (inserted > 0) {
                        const newChars = [];
                        for (let i = 0; i < inserted; i++) {
                            newChars.push({
                                char: change.text[i],
                                color: Math.random() > 0.5 ? 'blue' : 'green',
                                id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}-${i}`)
                            });
                        }
                        yarr.insert(start, newChars);
                    }
                });

                // If the document is empty, clear the array
                if (text.length === 0 && yarr.length > 0) {
                    yarr.delete(0, yarr.length);
                }

                // After applying all contentChanges:
                if (text.length === 0) {
                    if (yarr.length > 0) yarr.delete(0, yarr.length);
                } else {
                    // Use diffChars to get the difference between old and new text
                    const oldArr = [];
                    for (let i = 0; i < yarr.length; i++) oldArr.push(yarr.get(i));
                    const oldText = oldArr.map(e => e.char).join('');
                    const diffs = diffChars(oldText, text);

                    let oldIdx = 0;
                    let newArr: any[] = [];
                    for (const part of diffs) {
                        if (part.added) {
                            // Insert new chars with random color and id
                            for (let i = 0; i < part.value.length; i++) {
                                newArr.push({
                                    char: part.value[i],
                                    color: Math.random() > 0.5 ? 'blue' : 'green',
                                    id: (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}-${i}`)
                                });
                            }
                        } else if (part.removed) {
                            // Skip removed chars in oldArr
                            oldIdx += part.value.length;
                        } else {
                            // Unchanged chars: preserve old entries
                            for (let i = 0; i < part.value.length; i++) {
                                newArr.push(oldArr[oldIdx++]);
                            }
                        }
                    }
                    // Replace Yjs array with newArr
                    if (yarr.length > 0) yarr.delete(0, yarr.length);
                    yarr.insert(0, newArr);
                }

                saveYDoc(fileKey, ydoc);
            } catch (e) {
                console.error('Yjs extension error:', e);
            }
        })
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            { language: '*', scheme: 'file' },
            new (class implements vscode.DocumentSemanticTokensProvider {
                async provideDocumentSemanticTokens(
                    document: vscode.TextDocument
                ): Promise<vscode.SemanticTokens> {
                    const builder = new vscode.SemanticTokensBuilder(legend);

                    const fileKey = document.uri.fsPath;
                    const ydoc = getOrCreateYDoc(fileKey);
                    const yarr = ydoc.getArray<any>('chars');

                    let charIndex = 0;
                    for (let line = 0; line < document.lineCount; line++) {
                        const text = document.lineAt(line).text;
                        for (let char = 0; char < text.length; char++) {
                            const entry = yarr.get(charIndex);
                            if (entry && (entry.color === 'blue' || entry.color === 'green')) {
                                builder.push(line, char, 1, legend.tokenTypes.indexOf(entry.color), 0);
                            }
                            charIndex++;
                        }
                    }
                    return builder.build();
                }
            })(),
            legend
        )
    );
}

export function deactivate() {}
