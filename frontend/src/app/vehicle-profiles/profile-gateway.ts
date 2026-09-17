import { Injectable } from '@angular/core';
import { AssociateBindingProfile, BindingUnitConversion, ClearBindingProfile, GetBindingContext, SaveBindingProfile } from '../../../wailsjs/go/main/App';
import type { types } from '../../../wailsjs/go/models';

@Injectable({ providedIn: 'root' })
export class ProfileGateway {
  context(request: types.BindingRequest) { return GetBindingContext(request); }
  save(request: types.BindingRequest) { return SaveBindingProfile(request); }
  associate(request: types.BindingRequest) { return AssociateBindingProfile(request); }
  clear() { return ClearBindingProfile(); }
  conversion(source: string, target: string, meaning: string) { return BindingUnitConversion(source, target, meaning); }
}
