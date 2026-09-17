import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-toolbar-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      @switch (name()) {
        @case ('open') { <path d="M3 6.5h7l2 2h9v10H3zM3 9h18" /> }
        @case ('save') { <path d="M5 3h12l2 2v16H5zM8 3v6h8V3M8 21v-7h8v7" /> }
        @case ('undo') { <path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6" /> }
        @case ('redo') { <path d="m15 7 5 5-5 5m4-5h-8a6 6 0 0 0-6 6" /> }
        @case ('grid') { <path d="M4 4h16v16H4zM12 4v16M4 12h16" /> }
        @case ('changes') { <path d="M6 4h12M6 10h12M6 16h8M4 4h0M4 10h0M4 16h0" /> }
        @case ('help') { <path d="M9.5 9a2.7 2.7 0 1 1 4 2.4c-1 .5-1.5 1-1.5 2.1M12 18h0M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" /> }
      }
    </svg>
  `,
  styles: [`:host { display: inline-flex; width: 1rem; height: 1rem; } svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }`],
})
export class ToolbarIcon { readonly name = input.required<string>(); }
