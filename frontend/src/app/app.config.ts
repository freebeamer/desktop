import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { DesktopGateway, WailsDesktopGateway } from './core/desktop-gateway';
import { PlotlyRuntime, RealPlotlyRuntime } from './visualization/plotly-runtime';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: DesktopGateway, useExisting: WailsDesktopGateway },
    { provide: PlotlyRuntime, useExisting: RealPlotlyRuntime },
  ]
};
