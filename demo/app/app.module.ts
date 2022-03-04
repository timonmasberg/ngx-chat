import {NgModule} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {BrowserModule} from '@angular/platform-browser';
import {BrowserAnimationsModule} from '@angular/platform-browser/animations';
import {NgxChatModule} from '@pazznetwork/ngx-chat';
import {AppRoutingModule} from './app-routing.module';
import {AppComponent} from './app.component';
import {IqComponent} from './iq/iq.component';
import {MultiUserChatComponent} from './multi-user-chat/multi-user-chat.component';
import {IndexComponent} from './routes/index/index.component';
import {UiComponent} from './routes/ui/ui.component';
import {SendStanzaComponent} from './send-stanza/send-stanza.component';
import {MucComponent} from './routes/muc/muc.component';

@NgModule({
    declarations: [
        AppComponent,
        IqComponent,
        SendStanzaComponent,
        MultiUserChatComponent,
        IndexComponent,
        UiComponent,
        MucComponent,
    ],
    imports: [
        BrowserModule,
        BrowserAnimationsModule,
        ngxChatWithConfiguredAdapter(),
        FormsModule,
        AppRoutingModule,
    ],
    providers: [],
    bootstrap: [AppComponent]
})
export class AppModule {
}

function ngxChatWithConfiguredAdapter() {
    switch (process.env.NGX_CHAT_ADAPTER) {
        case 'JSXC':
            return NgxChatModule.forRootJSXC();
        case 'Converse':
            return NgxChatModule.forRootConverse();
        default:
            // Own Pazz implementation
            return NgxChatModule.forRoot();
    }
}
