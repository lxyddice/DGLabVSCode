import WebSocket from 'ws';
import log4js from 'log4js';
import fs from 'fs/promises';
import path from 'path';

const logger = log4js.getLogger('WSClient');
logger.level = 'debug';

export class WSClient {
    private vscode: any;
    private ws: WebSocket | null = null;
    private clientId: string = '';
    private connectMap = new Map<string, string>();
    private pulseData: any = {};
    private pulseName: string = "呼吸";
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private addStrengthInterval: number = 0;

    constructor(vscode: any) {
        this.vscode = vscode;
        this.setPulseName("呼吸");
    }

    public setaddStrengthInterval(interval: number) {
        this.addStrengthInterval = interval;
    }

    public getConfig() {
        const config = this.vscode.workspace.getConfiguration('dglabvscode');
        if (!config || !config.has('strength') || !config.has('pulseName') || !config.has('heartbeatInterval')) {
            logger.error("获取配置失败");
            return null;
        }
        if (Number(config.get('heartbeatInterval')) < 10) {
            logger.warn("心跳间隔过短，可能导致快速被电似（");
        }
        let messageSendOption = config.get('messageSendOption');
        switch (messageSendOption) {
            case "仅A通道输出":
                messageSendOption = "A";
                break;
            case "仅B通道输出":
                messageSendOption = "B";
                break;
            case "AB一起输出":
                messageSendOption = "AB";
                break;
            default:
                messageSendOption = "AB";
                break;
        }

        return {
            strength: config.get('strength'),
            pulseName: config.get('pulseName'),
            heartbeatInterval: config.get('heartbeatInterval') ? Number(config.get('heartbeatInterval')) : 10,
            maxAddInterval: config.get('maxAddInterval') ? Number(config.get('maxAddInterval')) : 50,
            onDidStartDebugSession: config.get('onDidStartDebugSession') ? config.get('onDidStartDebugSession') : "none",
            onDidTerminateDebugSession: config.get('onDidTerminateDebugSession') ? config.get('onDidTerminateDebugSession') : "none",
            onDidReceiveDebugSessionCustomEvent: config.get('onDidReceiveDebugSessionCustomEvent') ? config.get('onDidReceiveDebugSessionCustomEvent') : "none",
            onDidChangeBreakpoints: config.get('onDidChangeBreakpoints') ? config.get('onDidChangeBreakpoints') : "none",
            messageSendOption: messageSendOption,
        };
    }

    public async loadPulseData() {
        try {
            const filePath = path.join(__dirname, "../../wave.json");
            const data = await fs.readFile(filePath, 'utf-8');
            this.pulseData = JSON.parse(data);
            logger.info("加载波形数据成功");
        } catch (error) {
            logger.error("加载波形数据失败:", error);
            throw error;
        }
    }

    public connect(): Promise<string> {
        return new Promise((resolve, reject) => {
            const wsUrl = `wss://ws.dungeon-lab.cn/`;
            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => logger.info('WebSocket 已连接'));

            this.ws.on('message', this.handleMessage.bind(this, resolve));

            this.ws.on('error', (error) => {
                logger.error('WebSocket 连接出错:', error);
                reject(error);
                this.close();
            });

            this.ws.on('close', () => {
                logger.info('WebSocket 已关闭');
                this.stopHeartbeat();
            });
        });
    }

    private handleMessage(resolve: (clientId: string) => void, data: WebSocket.Data) {
        try {
            const message = JSON.parse(data.toString());

            if (message.type === 'bind') {
                this.clientId = message.clientId;
                resolve(this.clientId);
                this.startHeartbeat();
                this.updateConnectMap(message);
                this.vscode.window.showInformationMessage(`成功连接到ClientId:${message.clientId}，targetId:${message.targetId}`);
            }
            logger.info('收到消息:', message);
        } catch (error) {
            logger.error('处理消息失败:', error);
            logger.info('收到消息:', data.toString());
        }
    }

    private updateConnectMap(message: any) {
        const config = this.getConfig();
        if (message.targetId && config) {
            this.connectMap.set(message.clientId, message.targetId);
            if (config.strength !== undefined) {
                this.setStrength(1, 4, config.strength);
                this.setStrength(2, 4, config.strength);
            } else {
                logger.error("未设置基础强度");
            }
        }
    }

    private startHeartbeat() {
        const config = this.getConfig();
        if (!config) {
            logger.error("获取配置失败");
            return;
        }
        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.sendJsonMessage({
                    type: 'heartbeat',
                    clientId: this.clientId,
                    message: '200',
                });
                const connectMap = this.getConnectMap();
                if (connectMap.size === 0 && this.addStrengthInterval >= config.maxAddInterval) {
                    logger.debug("未连接任何设备或强度已满");
                    return;
                }
                this.addStrengthInterval += 1;
                logger.info(`基础强度+${this.addStrengthInterval}`);
                this.setStrength(1, 4, config.strength + this.addStrengthInterval);
                this.setStrength(2, 4, config.strength + this.addStrengthInterval);
            } else {
                logger.error('WebSocket 尚未连接');
            }
        }, config.heartbeatInterval * 1000);
    }

    private stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            this.addStrengthInterval = 0;
            logger.info('心跳已停止');
        }
    }

    public sendJsonMessage(message: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            logger.info('发送消息:', JSON.stringify(message));
        } else {
            logger.error('WebSocket 尚未连接');
        }
    }

    public close() {
        if (this.ws) {
            this.ws.close();
            logger.info('WebSocket 已关闭');
        }
        this.stopHeartbeat();
        this.connectMap.delete(this.clientId);
    }

    public async sendWaveMessage(wave: any, time: number) {
        if (wave === "this") {
            wave = await this.getPulseDataByName(this.pulseName);
        }
        if (!wave) {
            logger.error("波形数据为空，请先设置波形名称或输入波形数据");
            return;
        }
        const config = this.getConfig();
        if (!config) {
            logger.error("获取配置失败");
            return;
        }
        const messageSendOption = config.messageSendOption;
        for (const [clientId, targetId] of this.connectMap) {
            if (messageSendOption === "A") {
                this.sendJsonMessage({ type: 'clientMsg', channel: 'A', clientId, targetId, message: 'A:' + JSON.stringify(wave), time });
            } else if (messageSendOption === "B") {
                this.sendJsonMessage({ type: 'clientMsg', channel: 'B', clientId, targetId, message: 'B:' + JSON.stringify(wave), time });
            } else {
                this.sendJsonMessage({ type: 'clientMsg', channel: 'A', clientId, targetId, message: 'A:' + JSON.stringify(wave), time });
                this.sendJsonMessage({ type: 'clientMsg', channel: 'B', clientId, targetId, message: 'B:' + JSON.stringify(wave), time });
            }   
        }
    }

    public clearAllWave() {
        for (const [clientId, targetId] of this.connectMap) {
            this.sendJsonMessage({ type: 4, clientId: clientId, targetId: targetId, message: 'clear-1' });
            this.sendJsonMessage({ type: 4, clientId: clientId, targetId: targetId, message: 'clear-2' });
        }
        logger.info("已清除所有波形");
        return true;
    }

    public async sendFireMessage(wave: any, strength: number, time: number) {
        if (!wave) {
            logger.error("波形数据为空，请先设置波形名称或输入波形数据");
            return;
        }
        this.clearAllWave();
        const config = this.getConfig();
        
        if (!config) {
            logger.error("获取配置失败");
            return;
        }
        const orS = config.strength + this.addStrengthInterval;

        this.setStrength(1, 4, strength + orS);
        this.setStrength(2, 4, strength + orS);

        for (const [clientId, targetId] of this.connectMap) {
            await this.sendWaveMessage(wave, time);
        }
        await wait(600);
        this.setStrength(1, 4, orS);
        this.setStrength(2, 4, orS);
        
        logger.info(`已发送一键开火，强度${strength + orS}`);
        return true;
    }

    public async setStrength(channel: number, type: number, strength: number) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            logger.error('WebSocket 尚未连接');
            return false;
        }

        if (this.connectMap.size === 0) {
            logger.warn("未连接任何设备");
            return false;
        }

        for (const [clientId, targetId] of this.connectMap) {
            const message = this.createStrengthMessage(channel, type, strength, clientId, targetId);
            if (message) {
                this.sendJsonMessage(message);
            }
        }
        return true;
    }

    private createStrengthMessage(channel: number, type: number, strength: number, clientId: string, targetId: string) {
        if ([1, 2, 3].includes(type)) {
            return { type, channel, clientId, targetId, message: 'set channel', strength };
        } else if (type === 4) {
            return { type, clientId, targetId, message: `strength-${channel}+2+${strength}` };
        } else {
            logger.error("设置强度类型错误");
            return null;
        }
    }

    private convertToHexString(data: number[][][]) {
        return data.map(item => item.flat().map(num => num.toString(16).padStart(2, '0').toUpperCase()).join(''));
    }

    public async setPulseName(pulseName: string): Promise<boolean> {
        if (!this.pulseData["PULSE_DATA"]) {
            logger.warn("波形数据未加载，正在重新加载...");
            await this.loadPulseData();
            return true;
        }

        if (this.pulseData["PULSE_DATA"][pulseName]) {
            this.pulseName = pulseName;
            logger.info(`设置波形名称为${pulseName}`);
            return true;
        }

        logger.error(`波形名称${pulseName}不存在`);
        return false;
    }

    public async getPulseDataByName(pulseName: string) {
        const pulseData = this.pulseData["PULSE_DATA"];
        if (pulseData && pulseData[pulseName]) {
            return this.convertToHexString(pulseData[pulseName]);
        }
        logger.warn(`未找到波形数据:${pulseName}`);
        return null;
    }

    public getPulseName() {
        return this.pulseName;
    }

    public getConnectMap() {
        return this.connectMap;
    }
}
        
function wait(ms: number | undefined) {
    return new Promise<void>(resolve => setTimeout(() => resolve(), ms));
}
