import { TestBed } from '@angular/core/testing';
import { HelpDialog } from './help-dialog';
import { HelpStore } from './help-store';

describe('HelpDialog', () => {
  it('renders nothing when closed', () => {
    const fixture = TestBed.createComponent(HelpDialog);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.help-dialog')).toBeFalsy();
  });

  it('shows keyboard shortcuts by default when opened', () => {
    const fixture = TestBed.createComponent(HelpDialog);
    TestBed.inject(HelpStore).open();
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.help-dialog')).toBeTruthy();
    expect(compiled.textContent).toContain('Ctrl/Cmd K');
    expect(compiled.textContent).toContain('Restore the selected cell');
  });

  it('switches to the About tab and shows the safety language', () => {
    const fixture = TestBed.createComponent(HelpDialog);
    const store = TestBed.inject(HelpStore);
    store.open('about');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('BIN/XDF editing: experimental');
    expect(compiled.textContent).toContain('Do not flash generated files');
    expect(compiled.textContent).toContain('Wails');
  });

  it('closes on the close button', () => {
    const fixture = TestBed.createComponent(HelpDialog);
    const store = TestBed.inject(HelpStore);
    store.open();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[aria-label="Close"]') as HTMLButtonElement).click();
    expect(store.isOpen()).toBe(false);
  });
});
