import * as vscode from 'vscode';
import qr from 'qrcode';
import { WSClient } from './tools/wsConnect';
import log4js from 'log4js';

const logger = log4js.getLogger('WSClient');
logger.level = 'debug';

function applySettings () {
    const config = wsClient.getConfig();
    if (!config) {
        logger.error('No config found');
        return;
    }
    const strength = config.strength;
    const pulseName = config.pulseName;
    logger.debug(`strength: ${strength}, pulseName: ${pulseName}`);

    if (strength !== undefined) {
        wsClient.setStrength(1, 4, strength);
        wsClient.setStrength(2, 4, strength);
    }

    if (pulseName) {
        wsClient.setPulseName(pulseName);
    }
};

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('DGLabVSCode');

    outputChannel.appendLine('开始连接 WebSocket...');
    const createCommand = vscode.commands.registerCommand('dglabvscode.create', async function() {
        try {
            const clientId = await wsClient.connect();
            const url = `https://www.dungeon-lab.com/app-download.php#DGLAB-SOCKET#wss://ws.dungeon-lab.cn/${clientId}`;
            const qrCodeSvg = await qr.toString(url, { type: 'svg' });

            const panel = vscode.window.createWebviewPanel(
                'qrCodeWebview',
                '二维码',
                vscode.ViewColumn.One,
            );
            panel.webview.html = getWebviewContent(qrCodeSvg, url);
        } catch (error) {
            handleError('WebSocket 连接失败', error);
        }
    });

    const serR = vscode.commands.registerCommand('dglabvscode.serR', function () {
        const connectMap = wsClient.getConnectMap();
        if (connectMap.size === 0) {
            vscode.window.showErrorMessage('还没有创建连接喵');
            return;
        }
        logger.info("成功刷新配置");
        wsClient.setaddStrengthInterval(0);
        applySettings();
    });

    const setPulseNameCommand = vscode.commands.registerCommand('dglabvscode.setPulseName', function() {
        applySettings();
    });
    
    context.subscriptions.push(createCommand, setPulseNameCommand, serR);

    // 监听文本变化
    vscode.workspace.onDidChangeTextDocument((event) => {
        const editor = vscode.window.activeTextEditor;
        
        if (editor && event.document === editor.document) {
            const changes = event.contentChanges;
            
            changes.forEach(change => {
                if (wsClient.getConnectMap().size > 0) {
                    wsClient.sendWaveMessage("this", 0.3);
                }
            });
        }
    });    

    // 监听调试会话开始
    vscode.debug.onDidStartDebugSession(async session => {
        const config = wsClient.getConfig();
        if (!config || config.onDidStartDebugSession === undefined) {
            logger.error('No config found');
            return;
        }
        logger.debug(`Debug session started: ${session.name}`);
        await wsClient.sendFireMessage("this", config.onDidStartDebugSession, 0.6);
    });

    // 监听调试会话结束
    vscode.debug.onDidTerminateDebugSession(session => {
        const config = wsClient.getConfig();
        if (!config || config.onDidTerminateDebugSession === undefined) {
            logger.error('No config found');
            return;
        }
        logger.debug(`Debug session terminated: ${session.name}`);
        wsClient.sendFireMessage("this", config.onDidTerminateDebugSession, 0.6);
    });

    // 监听调试会话中的异常或错误情况
    vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
        if (event.event === 'output' && event.body.category === 'stderr') {
            const errorMessage = event.body.output;
            logger.debug(`Debug session error: ${errorMessage}`);
            const config = wsClient.getConfig();
            if (!config || config.onDidReceiveDebugSessionCustomEvent === undefined) {
                logger.error('No config found');
                return;
            }
            wsClient.sendFireMessage("this", config.onDidReceiveDebugSessionCustomEvent, 0.6);
        }
    });

    // 监听断点的改变
    vscode.debug.onDidChangeBreakpoints(event => {
        if (event.added.length > 0) {
            logger.debug(`Added ${event.added.length} breakpoints`);
        }
        if (event.removed.length > 0) {
            logger.debug(`Removed ${event.removed.length} breakpoints`);
        }
        const config = wsClient.getConfig();
        if (!config || config.onDidChangeBreakpoints === undefined) {
            logger.error('No config found');
            return;
        }
        wsClient.sendFireMessage("this", config.onDidChangeBreakpoints, 0.6);
    });

}

function getWebviewContent(qrCodeSvg: string, url: string): string {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>QR Code</title>
        </head>
        <body>
            <h1>扫描二维码</h1>
            <div><img src="data:image/svg+xml;base64,${btoa(qrCodeSvg)}" style="width: 30%; height: 30%;"></div>
            <p>URL->${url}</p>
        </body>
        </html>`;
}

// Helper function to handle errors
function handleError(context: string, error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`${context}: ${errorMessage}`);
}

const wsClient = new WSClient(vscode);

// Clean up when extension is deactivated
export function deactivate() {}
