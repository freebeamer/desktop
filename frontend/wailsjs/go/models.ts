export namespace types {
	
	export class AxisBinding {
	    parameterId: string;
	    axis: string;
	    channelId: string;
	    channelMeaning: string;
	    axisMeaning: string;
	    sourceUnit: string;
	    targetUnit: string;
	    scale: number;
	    offset: number;
	
	    static createFrom(source: any = {}) {
	        return new AxisBinding(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.parameterId = source["parameterId"];
	        this.axis = source["axis"];
	        this.channelId = source["channelId"];
	        this.channelMeaning = source["channelMeaning"];
	        this.axisMeaning = source["axisMeaning"];
	        this.sourceUnit = source["sourceUnit"];
	        this.targetUnit = source["targetUnit"];
	        this.scale = source["scale"];
	        this.offset = source["offset"];
	    }
	}
	export class AxisDetail {
	    units: string;
	    formula: string;
	    addressed: boolean;
	    elementBits: number;
	
	    static createFrom(source: any = {}) {
	        return new AxisDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.units = source["units"];
	        this.formula = source["formula"];
	        this.addressed = source["addressed"];
	        this.elementBits = source["elementBits"];
	    }
	}
	export class BatchEditOutcome {
	    mapId: number;
	    mapTitle: string;
	    selectedCells: number;
	    changedCells: number;
	    unchangedCells: number;
	    minimum: number;
	    maximum: number;
	    changedBytes: number;
	    canUndo: boolean;
	    canRedo: boolean;
	
	    static createFrom(source: any = {}) {
	        return new BatchEditOutcome(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mapId = source["mapId"];
	        this.mapTitle = source["mapTitle"];
	        this.selectedCells = source["selectedCells"];
	        this.changedCells = source["changedCells"];
	        this.unchangedCells = source["unchangedCells"];
	        this.minimum = source["minimum"];
	        this.maximum = source["maximum"];
	        this.changedBytes = source["changedBytes"];
	        this.canUndo = source["canUndo"];
	        this.canRedo = source["canRedo"];
	    }
	}
	export class BindingAxisOption {
	    parameterId: string;
	    title: string;
	    axis: string;
	    unit: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new BindingAxisOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.parameterId = source["parameterId"];
	        this.title = source["title"];
	        this.axis = source["axis"];
	        this.unit = source["unit"];
	        this.count = source["count"];
	    }
	}
	export class BindingCatalog {
	    id: string;
	    version: number;
	
	    static createFrom(source: any = {}) {
	        return new BindingCatalog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.version = source["version"];
	    }
	}
	export class BindingCompatibility {
	    state: string;
	    reasons: string[];
	    verified: boolean;
	
	    static createFrom(source: any = {}) {
	        return new BindingCompatibility(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.state = source["state"];
	        this.reasons = source["reasons"];
	        this.verified = source["verified"];
	    }
	}
	export class VehicleProfile {
	    id: string;
	    label: string;
	    ecuFamily: string;
	    software: string;
	    telemetryEvidence: string;
	    calibrationEvidence: string;
	    workspace: BindingWorkspace;
	    catalogs: BindingCatalog[];
	    bindings: AxisBinding[];
	
	    static createFrom(source: any = {}) {
	        return new VehicleProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.ecuFamily = source["ecuFamily"];
	        this.software = source["software"];
	        this.telemetryEvidence = source["telemetryEvidence"];
	        this.calibrationEvidence = source["calibrationEvidence"];
	        this.workspace = this.convertValues(source["workspace"], BindingWorkspace);
	        this.catalogs = this.convertValues(source["catalogs"], BindingCatalog);
	        this.bindings = this.convertValues(source["bindings"], AxisBinding);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BindingSession {
	    scopeSha256: string;
	    deviceId: string;
	    sessionId: string;
	    catalogId: string;
	    catalogVersion: number;
	    vehicleLabel: string;
	    ecuFamily: string;
	    software: string;
	    channels: string[];
	
	    static createFrom(source: any = {}) {
	        return new BindingSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.scopeSha256 = source["scopeSha256"];
	        this.deviceId = source["deviceId"];
	        this.sessionId = source["sessionId"];
	        this.catalogId = source["catalogId"];
	        this.catalogVersion = source["catalogVersion"];
	        this.vehicleLabel = source["vehicleLabel"];
	        this.ecuFamily = source["ecuFamily"];
	        this.software = source["software"];
	        this.channels = source["channels"];
	    }
	}
	export class BindingWorkspace {
	    definitionId: string;
	    definitionSha256: string;
	    originalSha256: string;
	    originalSize: number;
	
	    static createFrom(source: any = {}) {
	        return new BindingWorkspace(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.definitionId = source["definitionId"];
	        this.definitionSha256 = source["definitionSha256"];
	        this.originalSha256 = source["originalSha256"];
	        this.originalSize = source["originalSize"];
	    }
	}
	export class BindingContext {
	    sessionFingerprint: string;
	    workspaceGeneration: number;
	    liveGeneration: number;
	    workspace: BindingWorkspace;
	    session: BindingSession;
	    axes: BindingAxisOption[];
	    profiles: VehicleProfile[];
	    activeProfileId: string;
	    compatibility: BindingCompatibility;
	
	    static createFrom(source: any = {}) {
	        return new BindingContext(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionFingerprint = source["sessionFingerprint"];
	        this.workspaceGeneration = source["workspaceGeneration"];
	        this.liveGeneration = source["liveGeneration"];
	        this.workspace = this.convertValues(source["workspace"], BindingWorkspace);
	        this.session = this.convertValues(source["session"], BindingSession);
	        this.axes = this.convertValues(source["axes"], BindingAxisOption);
	        this.profiles = this.convertValues(source["profiles"], VehicleProfile);
	        this.activeProfileId = source["activeProfileId"];
	        this.compatibility = this.convertValues(source["compatibility"], BindingCompatibility);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BindingConversion {
	    scale: number;
	    offset: number;
	
	    static createFrom(source: any = {}) {
	        return new BindingConversion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.scale = source["scale"];
	        this.offset = source["offset"];
	    }
	}
	export class BindingRequest {
	    sessionFingerprint: string;
	    workspaceGeneration: number;
	    liveGeneration: number;
	    deviceId: string;
	    sessionId: string;
	    profile: VehicleProfile;
	
	    static createFrom(source: any = {}) {
	        return new BindingRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionFingerprint = source["sessionFingerprint"];
	        this.workspaceGeneration = source["workspaceGeneration"];
	        this.liveGeneration = source["liveGeneration"];
	        this.deviceId = source["deviceId"];
	        this.sessionId = source["sessionId"];
	        this.profile = this.convertValues(source["profile"], VehicleProfile);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class CellRange {
	    startRow: number;
	    startColumn: number;
	    endRow: number;
	    endColumn: number;
	
	    static createFrom(source: any = {}) {
	        return new CellRange(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.startRow = source["startRow"];
	        this.startColumn = source["startColumn"];
	        this.endRow = source["endRow"];
	        this.endColumn = source["endColumn"];
	    }
	}
	export class CellOperationRequest {
	    generation: number;
	    mapId: number;
	    selection: CellRange;
	    operation: string;
	    operand: number;
	
	    static createFrom(source: any = {}) {
	        return new CellOperationRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.generation = source["generation"];
	        this.mapId = source["mapId"];
	        this.selection = this.convertValues(source["selection"], CellRange);
	        this.operation = source["operation"];
	        this.operand = source["operand"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ChecksumSummary {
	    provider: string;
	    status: string;
	    regions: number;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new ChecksumSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.status = source["status"];
	        this.regions = source["regions"];
	        this.message = source["message"];
	    }
	}
	export class DesktopCompatibility {
	    regionFitsRom: boolean;
	    addressedMaps: number;
	    totalMaps: number;
	    mapValidationErrors: number;
	
	    static createFrom(source: any = {}) {
	        return new DesktopCompatibility(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.regionFitsRom = source["regionFitsRom"];
	        this.addressedMaps = source["addressedMaps"];
	        this.totalMaps = source["totalMaps"];
	        this.mapValidationErrors = source["mapValidationErrors"];
	    }
	}
	export class EditDiff {
	    mapId: number;
	    mapTitle: string;
	    row: number;
	    column: number;
	    index: number;
	    address: string;
	    beforeRaw: number;
	    afterRaw: number;
	    beforeValue: number;
	    afterValue: number;
	
	    static createFrom(source: any = {}) {
	        return new EditDiff(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mapId = source["mapId"];
	        this.mapTitle = source["mapTitle"];
	        this.row = source["row"];
	        this.column = source["column"];
	        this.index = source["index"];
	        this.address = source["address"];
	        this.beforeRaw = source["beforeRaw"];
	        this.afterRaw = source["afterRaw"];
	        this.beforeValue = source["beforeValue"];
	        this.afterValue = source["afterValue"];
	    }
	}
	export class DiffSummary {
	    changedBytes: number;
	    edits: EditDiff[];
	
	    static createFrom(source: any = {}) {
	        return new DiffSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.changedBytes = source["changedBytes"];
	        this.edits = this.convertValues(source["edits"], EditDiff);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ECUSummary {
	    manufacturer: string;
	    vendor: string;
	    family: string;
	    engine: string;
	    confidence: string;
	
	    static createFrom(source: any = {}) {
	        return new ECUSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.manufacturer = source["manufacturer"];
	        this.vendor = source["vendor"];
	        this.family = source["family"];
	        this.engine = source["engine"];
	        this.confidence = source["confidence"];
	    }
	}
	
	export class EditOutcome {
	    mapId: number;
	    mapTitle: string;
	    row: number;
	    column: number;
	    index: number;
	    requested: number;
	    encoded: number;
	    raw: number;
	    address: string;
	    changedBytes: number;
	    canUndo: boolean;
	    canRedo: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EditOutcome(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mapId = source["mapId"];
	        this.mapTitle = source["mapTitle"];
	        this.row = source["row"];
	        this.column = source["column"];
	        this.index = source["index"];
	        this.requested = source["requested"];
	        this.encoded = source["encoded"];
	        this.raw = source["raw"];
	        this.address = source["address"];
	        this.changedBytes = source["changedBytes"];
	        this.canUndo = source["canUndo"];
	        this.canRedo = source["canRedo"];
	    }
	}
	export class HealthStatus {
	    ready: boolean;
	    apiVersion: string;
	    engine: string;
	
	    static createFrom(source: any = {}) {
	        return new HealthStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ready = source["ready"];
	        this.apiVersion = source["apiVersion"];
	        this.engine = source["engine"];
	    }
	}
	export class LiveChannel {
	    id: string;
	    label: string;
	    unit: string;
	    sourceUnit: string;
	    validation: string;
	
	    static createFrom(source: any = {}) {
	        return new LiveChannel(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.unit = source["unit"];
	        this.sourceUnit = source["sourceUnit"];
	        this.validation = source["validation"];
	    }
	}
	export class LiveCatalog {
	    id: string;
	    version: number;
	    provenance: string;
	    channels: LiveChannel[];
	
	    static createFrom(source: any = {}) {
	        return new LiveCatalog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.version = source["version"];
	        this.provenance = source["provenance"];
	        this.channels = this.convertValues(source["channels"], LiveChannel);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class LiveClientSummary {
	    id: string;
	    displayName: string;
	    // Go type: time
	    createdAt: any;
	
	    static createFrom(source: any = {}) {
	        return new LiveClientSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.displayName = source["displayName"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LiveConnectionStatus {
	    generation: number;
	    state: string;
	    message?: string;
	    retryable: boolean;
	    // Go type: time
	    backoffUntil?: any;
	    catchingUp: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LiveConnectionStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.generation = source["generation"];
	        this.state = source["state"];
	        this.message = source["message"];
	        this.retryable = source["retryable"];
	        this.backoffUntil = this.convertValues(source["backoffUntil"], null);
	        this.catchingUp = source["catchingUp"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LivePairingLink {
	    pairingToken: string;
	    deepLink: string;
	    displayName: string;
	    // Go type: time
	    expiresAt: any;
	
	    static createFrom(source: any = {}) {
	        return new LivePairingLink(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pairingToken = source["pairingToken"];
	        this.deepLink = source["deepLink"];
	        this.displayName = source["displayName"];
	        this.expiresAt = this.convertValues(source["expiresAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MapDetail {
	    id: number;
	    title: string;
	    description: string;
	    categories: string[];
	    shape: string;
	    diagnostics?: string;
	    rows: number;
	    columns: number;
	    x: AxisDetail;
	    y: AxisDetail;
	    z: AxisDetail;
	    xValues?: number[];
	    xRaw?: number[];
	    xAddresses?: string[];
	    yValues?: number[];
	    yRaw?: number[];
	    yAddresses?: string[];
	    zValues?: number[][];
	    zRaw?: number[][];
	    zAddresses?: string[][];
	
	    static createFrom(source: any = {}) {
	        return new MapDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.categories = source["categories"];
	        this.shape = source["shape"];
	        this.diagnostics = source["diagnostics"];
	        this.rows = source["rows"];
	        this.columns = source["columns"];
	        this.x = this.convertValues(source["x"], AxisDetail);
	        this.y = this.convertValues(source["y"], AxisDetail);
	        this.z = this.convertValues(source["z"], AxisDetail);
	        this.xValues = source["xValues"];
	        this.xRaw = source["xRaw"];
	        this.xAddresses = source["xAddresses"];
	        this.yValues = source["yValues"];
	        this.yRaw = source["yRaw"];
	        this.yAddresses = source["yAddresses"];
	        this.zValues = source["zValues"];
	        this.zRaw = source["zRaw"];
	        this.zAddresses = source["zAddresses"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MapFilter {
	    query: string;
	    category: string;
	
	    static createFrom(source: any = {}) {
	        return new MapFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.query = source["query"];
	        this.category = source["category"];
	    }
	}
	export class MapSummary {
	    id: number;
	    title: string;
	    categories: string[];
	    shape: string;
	
	    static createFrom(source: any = {}) {
	        return new MapSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.categories = source["categories"];
	        this.shape = source["shape"];
	    }
	}
	export class MapPage {
	    generation: number;
	    total: number;
	    categories: string[];
	    maps: MapSummary[];
	
	    static createFrom(source: any = {}) {
	        return new MapPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.generation = source["generation"];
	        this.total = source["total"];
	        this.categories = source["categories"];
	        this.maps = this.convertValues(source["maps"], MapSummary);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class RecentEntry {
	    xdfPath: string;
	    binPath: string;
	
	    static createFrom(source: any = {}) {
	        return new RecentEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.xdfPath = source["xdfPath"];
	        this.binPath = source["binPath"];
	    }
	}
	export class RomSummary {
	    sizeBytes: number;
	    sha256: string;
	
	    static createFrom(source: any = {}) {
	        return new RomSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sizeBytes = source["sizeBytes"];
	        this.sha256 = source["sha256"];
	    }
	}
	export class SaveOutcome {
	    path: string;
	    sha256: string;
	    provider: string;
	    regionsVerified: number;
	    wasAlreadyValid: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SaveOutcome(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.sha256 = source["sha256"];
	        this.provider = source["provider"];
	        this.regionsVerified = source["regionsVerified"];
	        this.wasAlreadyValid = source["wasAlreadyValid"];
	    }
	}
	
	export class XDFSummary {
	    version: string;
	    categories: number;
	    tables: number;
	    flags: number;
	
	    static createFrom(source: any = {}) {
	        return new XDFSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.categories = source["categories"];
	        this.tables = source["tables"];
	        this.flags = source["flags"];
	    }
	}
	export class WorkspaceSummary {
	    generation: number;
	    xdfPath: string;
	    binPath: string;
	    rom: RomSummary;
	    ecu: ECUSummary;
	    xdf: XDFSummary;
	    compatibility: DesktopCompatibility;
	    checksum: ChecksumSummary;
	    editingAllowed: boolean;
	    refusalReason?: string;
	    changedBytes: number;
	    editCount: number;
	    canUndo: boolean;
	    canRedo: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.generation = source["generation"];
	        this.xdfPath = source["xdfPath"];
	        this.binPath = source["binPath"];
	        this.rom = this.convertValues(source["rom"], RomSummary);
	        this.ecu = this.convertValues(source["ecu"], ECUSummary);
	        this.xdf = this.convertValues(source["xdf"], XDFSummary);
	        this.compatibility = this.convertValues(source["compatibility"], DesktopCompatibility);
	        this.checksum = this.convertValues(source["checksum"], ChecksumSummary);
	        this.editingAllowed = source["editingAllowed"];
	        this.refusalReason = source["refusalReason"];
	        this.changedBytes = source["changedBytes"];
	        this.editCount = source["editCount"];
	        this.canUndo = source["canUndo"];
	        this.canRedo = source["canRedo"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

