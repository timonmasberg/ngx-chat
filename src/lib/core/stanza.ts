export interface Stanza extends Element {
}

export interface IqResponseStanza<ResponseType extends 'result' | 'error' = 'result' | 'error'> extends Stanza {
}

export interface PresenceStanza extends Stanza {
}

export interface MessageWithBodyStanza extends Stanza {
}
