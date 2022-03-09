export enum ChatAdapter {
    pazz = 'pazz',
    jsxc = 'JSXC',
    converse = 'ConverseJS',
}


export interface DemoEnvironment {
    production: boolean,
    chatAdapter: ChatAdapter,
}
