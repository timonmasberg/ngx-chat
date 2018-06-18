import { AfterViewInit, Directive, ElementRef, Input, Renderer2 } from '@angular/core';

@Directive({
    selector: '[ngxChatLinks]'
})
export class LinksDirective implements AfterViewInit {

    @Input('ngxChatLinks') ngxChatLinks: string;

    constructor(private el: ElementRef, private renderer: Renderer2) {
    }

    private transform() {
        const message: string = this.ngxChatLinks;

        if (message) {
            const urlRegex = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
            const links = this.getAllMatches(urlRegex, message);

            const container = this.renderer.createElement('div');
            let lastIndex = 0;
            for (let i = 0; i < links.length; i++) {
                const currentIndex = message.indexOf(links[i]);

                const textBeforeLink = message.substring(lastIndex, currentIndex);
                this.renderer.appendChild(container, this.renderer.createText(textBeforeLink));

                const a = this.renderer.createElement('a');
                a.href = links[i];
                a.target = '_blank';
                a.innerText = this.shorten(links[i]);
                this.renderer.appendChild(container, a);

                lastIndex = currentIndex + links[i].length;
            }
            const textAfterLastLink = this.renderer.createText(message.substring(lastIndex));
            this.renderer.appendChild(container, textAfterLastLink);
            this.renderer.appendChild(this.el.nativeElement, container);
        }
    }

    private getAllMatches(urlRegex: RegExp, message: string) {
        const matches: string[] = [];
        let match;
        do {
            match = urlRegex.exec(message);
            if (match) {
                matches.push(match[0]);
            }
        } while (match);
        return matches;
    }

    private shorten(url: string) {
        const parser = document.createElement('a');
        parser.href = url;

        let shortenedPathname = parser.pathname;
        if (shortenedPathname.length > 17) {
            shortenedPathname = shortenedPathname.substring(0, 5) + '...' + shortenedPathname.substring(shortenedPathname.length - 10);
        }

        return parser.protocol + '//' + parser.host + shortenedPathname;
    }

    ngAfterViewInit(): void {
        this.transform();
    }

}
