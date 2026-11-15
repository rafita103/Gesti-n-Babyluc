import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  collection,
  query,
  where,
  getDocFromServer,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  type Unsubscribe
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const dbFs = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write'
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email
        })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(dbFs, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export const COLLECTIONS = [
  'empresa',
  'categorias',
  'proveedores',
  'articulos',
  'variantes',
  'clientes',
  'pedidos',
  'lineasPedido',
  'facturas_compra',
  'registros_iva',
  'movimientos_stock'
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

const BUSINESS_COLLECTIONS: CollectionName[] = [
  'categorias',
  'proveedores',
  'articulos',
  'variantes',
  'clientes',
  'pedidos',
  'lineasPedido',
  'facturas_compra',
  'registros_iva',
  'movimientos_stock'
];

let lastGenId = 0;
export function nextUniqueId(): number {
  const candidate = Date.now() * 100 + Math.floor(Math.random() * 100);
  lastGenId = candidate > lastGenId ? candidate : lastGenId + 1;
  return lastGenId;
}

function cleanUndefined(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => cleanUndefined(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = cleanUndefined(v);
      }
    }
    return out;
  }
  return value;
}

function truncStr(val: unknown, maxLen: number): string {
  return String(val ?? '').slice(0, maxLen);
}

function optStr(val: unknown, maxLen: number): string | null {
  if (val === null || val === undefined) return null;
  return String(val).slice(0, maxLen);
}

function optNum(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function numOrZero(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

export function sanitizeForFirestore(
  table: CollectionName,
  raw: Record<string, unknown>,
  uid: string
): Record<string, unknown> {
  const id = Number(raw.id);
  switch (table) {
    case 'empresa': {
      const logoStr = optStr(raw.logo, 700000);
      const upRaw = (raw.ultimoNumeroPedido && typeof raw.ultimoNumeroPedido === 'object'
        ? raw.ultimoNumeroPedido
        : { año: new Date().getFullYear(), numero: 0 }) as Record<string, unknown>;
      const ufRaw = (raw.ultimoNumeroFactura && typeof raw.ultimoNumeroFactura === 'object'
        ? raw.ultimoNumeroFactura
        : { año: new Date().getFullYear(), numero: 0 }) as Record<string, unknown>;
      return {
        id: Number.isFinite(id) ? id : 1,
        ownerId: uid,
        nombre: truncStr(raw.nombre || 'babyluc', 150),
        cif: optStr(raw.cif, 40),
        direccion: optStr(raw.direccion, 300),
        telefono: optStr(raw.telefono, 40),
        email: optStr(raw.email, 150),
        logo: logoStr && logoStr.length <= 700000 ? logoStr : '',
        mensajeAlbaran: optStr(raw.mensajeAlbaran, 500),
        ivaDefecto: optNum(raw.ivaDefecto) ?? 21,
        pedidosPorPagina: optNum(raw.pedidosPorPagina) ?? 10,
        umbralStockGlobal: optNum(raw.umbralStockGlobal) ?? 3,
        pinHash: optStr(raw.pinHash, 128),
        pinActivo: Boolean(raw.pinActivo),
        ultimoNumeroPedido: {
          año: numOrZero(upRaw['año'] ?? new Date().getFullYear()),
          numero: numOrZero(upRaw['numero'] ?? 0)
        },
        ultimoNumeroFactura: {
          año: numOrZero(ufRaw['año'] ?? new Date().getFullYear()),
          numero: numOrZero(ufRaw['numero'] ?? 0)
        },
        tiposPortes: Array.isArray(raw.tiposPortes)
          ? raw.tiposPortes
              .filter((p) => p && typeof p === 'object')
              .slice(0, 100)
              .map((p, idx) => {
                const item = p as Record<string, unknown>;
                return {
                  id: truncStr(item.id || `porte_${idx}`, 64),
                  nombre: truncStr(String(item.nombre ?? '').trim() || 'Portes', 120),
                  precio: numOrZero(item.precio)
                };
              })
          : [],
        tallasCatalogo: Array.isArray(raw.tallasCatalogo)
          ? raw.tallasCatalogo
              .map((t) => truncStr(String(t ?? '').trim(), 40))
              .filter((t) => t.length > 0)
              .slice(0, 150)
          : [],
        coloresCatalogo: Array.isArray(raw.coloresCatalogo)
          ? raw.coloresCatalogo
              .map((c) => truncStr(String(c ?? '').trim(), 40))
              .filter((c) => c.length > 0)
              .slice(0, 150)
          : [],
        apiKeyGemini: optStr(raw.apiKeyGemini, 200),
        updatedAt: optStr(raw.updatedAt, 64)
      };
    }
    case 'categorias':
      return {
        id,
        ownerId: uid,
        nombre: truncStr(String(raw.nombre ?? '').trim() || 'Categoría', 120)
      };
    case 'proveedores':
      return {
        id,
        ownerId: uid,
        nombre: truncStr(String(raw.nombre ?? '').trim() || 'Proveedor', 150),
        CIF: optStr(raw.CIF, 40),
        telefono: optStr(raw.telefono, 40),
        email: optStr(raw.email, 150),
        notas: optStr(raw.notas, 1000),
        fechaCreacion: optStr(raw.fechaCreacion, 64)
      };
    case 'articulos': {
      const aliases = Array.isArray(raw.aliases)
        ? raw.aliases
            .map((a) => truncStr(String(a ?? '').trim(), 120))
            .filter((a) => a.length > 0)
            .slice(0, 50)
        : [];
      return {
        id,
        ownerId: uid,
        codigo: optStr(raw.codigo, 80),
        nombre: truncStr(String(raw.nombre ?? '').trim() || 'Artículo', 200),
        aliases,
        categoriaId: optNum(raw.categoriaId),
        proveedorId: optNum(raw.proveedorId),
        precioCompra: numOrZero(raw.precioCompra),
        precioVenta: numOrZero(raw.precioVenta),
        tipoIVA: numOrZero(raw.tipoIVA || 21),
        umbralAlerta: optNum(raw.umbralAlerta),
        activo: raw.activo === undefined ? true : Boolean(raw.activo),
        fechaCreacion: optStr(raw.fechaCreacion, 64)
      };
    }
    case 'variantes':
      return {
        id,
        ownerId: uid,
        articuloId: numOrZero(raw.articuloId),
        talla: truncStr(raw.talla ?? 'Única', 60),
        color: truncStr(raw.color ?? 'Estándar', 60),
        stock: numOrZero(raw.stock)
      };
    case 'clientes':
      return {
        id,
        ownerId: uid,
        nombre: optStr(raw.nombre, 200),
        telefono: optStr(raw.telefono, 40),
        email: optStr(raw.email, 150),
        nif: optStr(raw.nif, 40),
        calle: optStr(raw.calle, 200),
        ciudad: optStr(raw.ciudad, 100),
        cp: optStr(raw.cp, 20),
        direccion: optStr(raw.direccion, 350),
        notas: optStr(raw.notas, 2000),
        fechaCreacion: optStr(raw.fechaCreacion, 64)
      };
    case 'pedidos': {
      const validStates = new Set([
        'pendiente_pago',
        'pagado',
        'enviado',
        'completado',
        'cancelado'
      ]);
      const estado = validStates.has(String(raw.estado))
        ? String(raw.estado)
        : 'pendiente_pago';
      const hist = Array.isArray(raw.historialEstados)
        ? raw.historialEstados
            .filter((h) => h && typeof h === 'object')
            .slice(0, 100)
            .map((h) => cleanUndefined(h) as Record<string, unknown>)
        : [];
      const devs = Array.isArray(raw.devoluciones)
        ? raw.devoluciones
            .filter((d) => d && typeof d === 'object')
            .slice(0, 50)
            .map((d) => cleanUndefined(d) as Record<string, unknown>)
        : [];
      return {
        id,
        ownerId: uid,
        numero: truncStr(String(raw.numero ?? '').trim() || `BLC-${id}`, 40),
        clienteId: optNum(raw.clienteId),
        nombreCliente: optStr(raw.nombreCliente, 200),
        telefonoCliente: optStr(raw.telefonoCliente, 40),
        fecha: optStr(raw.fecha, 64),
        estado,
        metodoPago: optStr(raw.metodoPago, 40),
        numeroFactura: optStr(raw.numeroFactura, 40),
        fechaPago: optStr(raw.fechaPago, 64),
        fechaEnvio: optStr(raw.fechaEnvio, 64),
        fechaCompletado: optStr(raw.fechaCompletado, 64),
        notas: optStr(raw.notas, 2000),
        descuentoTipo: optStr(raw.descuentoTipo, 10),
        descuentoValor: optNum(raw.descuentoValor),
        gastosEnvio: optNum(raw.gastosEnvio),
        enBolsa: Boolean(raw.enBolsa),
        bolsaId: optStr(raw.bolsaId, 80),
        devoluciones: devs,
        historialEstados: hist
      };
    }
    case 'lineasPedido':
      return {
        id,
        ownerId: uid,
        pedidoId: numOrZero(raw.pedidoId),
        articuloId: optNum(raw.articuloId),
        varianteId: optNum(raw.varianteId),
        nombreArticulo: truncStr(raw.nombreArticulo ?? 'Artículo', 200),
        descripcionVariante: optStr(raw.descripcionVariante, 150),
        cantidad: numOrZero(raw.cantidad),
        precioUnitario: numOrZero(raw.precioUnitario),
        tipoIVA: optNum(raw.tipoIVA) ?? 21
      };
    case 'facturas_compra': {
      const arts = Array.isArray(raw.articulos)
        ? raw.articulos
            .filter((a) => a && typeof a === 'object')
            .slice(0, 200)
            .map((a) => cleanUndefined(a) as Record<string, unknown>)
        : [];
      const estado = raw.estado === 'pendiente_recibir' ? 'pendiente_recibir' : 'recibido';
      const stockAplicado = raw.stockAplicado === undefined ? estado !== 'pendiente_recibir' : Boolean(raw.stockAplicado);
      return {
        id,
        ownerId: uid,
        proveedorId: optNum(raw.proveedorId),
        nombreProveedor: optStr(raw.nombreProveedor, 200),
        fecha: optStr(raw.fecha, 64),
        numeroFactura: truncStr(String(raw.numeroFactura ?? '').trim() || `FAC-${id}`, 80),
        baseImponible: numOrZero(raw.baseImponible),
        cuotaIVA: numOrZero(raw.cuotaIVA),
        recargoEquivalencia: numOrZero(raw.recargoEquivalencia),
        total: numOrZero(raw.total),
        estado,
        fechaRecepcion: optStr(raw.fechaRecepcion, 64),
        stockAplicado,
        articulos: arts
      };
    }
    case 'registros_iva': {
      const validIva = new Set(['pendiente', 'pagado', 'aplazado']);
      const estado = validIva.has(String(raw.estado)) ? String(raw.estado) : 'pendiente';
      return {
        id,
        ownerId: uid,
        trimestre: numOrZero(raw.trimestre),
        año: numOrZero(raw['año']),
        estado,
        fechaGeneracion: optStr(raw.fechaGeneracion, 64),
        fechaPago: optStr(raw.fechaPago, 64),
        notas: optStr(raw.notas, 2000),
        baseImponible: numOrZero(raw.baseImponible),
        totalIVA: numOrZero(raw.totalIVA),
        desgloseIVA:
          raw.desgloseIVA && typeof raw.desgloseIVA === 'object'
            ? (cleanUndefined(raw.desgloseIVA) as Record<string, unknown>)
            : {},
        reInformativo:
          raw.reInformativo && typeof raw.reInformativo === 'object'
            ? (cleanUndefined(raw.reInformativo) as Record<string, unknown>)
            : {}
      };
    }
    case 'movimientos_stock':
      return {
        id,
        ownerId: uid,
        fecha: truncStr(raw.fecha || new Date().toISOString(), 64),
        articuloId: optNum(raw.articuloId),
        varianteId: optNum(raw.varianteId),
        nombreArticulo: truncStr(String(raw.nombreArticulo ?? '').trim() || 'Artículo', 200),
        descripcionVariante: optStr(raw.descripcionVariante, 150),
        tipo: truncStr(String(raw.tipo ?? '').trim() || 'ajuste', 40),
        delta: numOrZero(raw.delta),
        stockResultante: optNum(raw.stockResultante),
        referencia: optStr(raw.referencia, 80),
        nota: optStr(raw.nota, 300)
      };
  }
}

export interface SyncStatus {
  user: { uid: string; email: string | null; displayName: string | null; photoURL: string | null; emailVerified: boolean } | null;
  ready: boolean;
  syncing: boolean;
  pendingLocalCount: number;
  lastError: string | null;
}

// Dexie minimal duck-typing to keep runtime decoupled from CDN global
interface DexieTableLike {
  toArray(): Promise<Record<string, unknown>[]>;
  get(key: number): Promise<Record<string, unknown> | undefined>;
  put(item: Record<string, unknown>): Promise<number>;
  delete(key: number): Promise<void>;
  count(): Promise<number>;
  where(idx: string): { equals(val: unknown): { first(): Promise<Record<string, unknown> | undefined> } };
  hook(event: 'creating', fn: (primKey: unknown, obj: Record<string, unknown>, trans: unknown) => unknown): void;
  hook(event: 'updating', fn: (mods: Record<string, unknown>, primKey: number, obj: Record<string, unknown>, trans: unknown) => void): void;
  hook(event: 'deleting', fn: (primKey: number, obj: Record<string, unknown>, trans: unknown) => void): void;
}

interface DexieDbLike {
  table(name: string): DexieTableLike;
}

class BabylucFirebaseBridge {
  private dexieDb: DexieDbLike | null = null;
  private onRemoteChangeCb: ((tables: CollectionName[]) => void) | null = null;
  private onStatusChangeCb: ((status: SyncStatus) => void) | null = null;
  private unsubscribers: Unsubscribe[] = [];
  private currentUser: User | null = null;
  private authInitialized = false;
  private hooksAttached = false;
  private isApplyingRemote = false;

  private pendingOps = new Map<string, { table: CollectionName; id: number; op: 'upsert' | 'delete' }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private remoteIdsByTable = new Map<CollectionName, Set<number>>();
  private pendingLocalCount = 0;
  private syncing = false;
  private lastError: string | null = null;
  private authListeners: Array<(status: SyncStatus) => void> = [];

  constructor() {
    onAuthStateChanged(auth, async (user) => {
      this.currentUser = user;
      this.authInitialized = true;
      this.stopListeners();
      this.pendingLocalCount = 0;
      this.lastError = null;
      this.emitStatus();

      if (user && this.dexieDb) {
        await this.startSyncSession(user);
      }
      this.emitStatus();
    });
  }

  public getStatus(): SyncStatus {
    return {
      user: this.currentUser
        ? {
            uid: this.currentUser.uid,
            email: this.currentUser.email,
            displayName: this.currentUser.displayName,
            photoURL: this.currentUser.photoURL,
            emailVerified: this.currentUser.emailVerified
          }
        : null,
      ready: this.authInitialized,
      syncing: this.syncing,
      pendingLocalCount: this.pendingLocalCount,
      lastError: this.lastError
    };
  }

  public onStatusChange(cb: (status: SyncStatus) => void): () => void {
    this.authListeners.push(cb);
    cb(this.getStatus());
    return () => {
      this.authListeners = this.authListeners.filter((x) => x !== cb);
    };
  }

  private emitStatus() {
    const st = this.getStatus();
    if (this.onStatusChangeCb) this.onStatusChangeCb(st);
    this.authListeners.forEach((cb) => cb(st));
  }

  public async signInWithCredentials(username: string, password: string): Promise<User> {
    const cleanUser = username.trim().toLowerCase();
    if (cleanUser !== 'admin' || password !== '13111994') {
      throw new Error('Usuario o contraseña incorrectos.');
    }
    const email = 'admin@babyluc.app';
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      return cred.user;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
        try {
          const created = await createUserWithEmailAndPassword(auth, email, password);
          return created.user;
        } catch (createErr: unknown) {
          const createCode = (createErr as { code?: string })?.code || '';
          if (createCode === 'auth/operation-not-allowed') {
            throw new Error(
              `Activa "Correo electrónico/contraseña" una sola vez en Firebase Console (${firebaseConfig.projectId} → Authentication → Sign-in method).`
            );
          }
          throw createErr;
        }
      }
      if (code === 'auth/operation-not-allowed') {
        throw new Error(
          `Activa "Correo electrónico/contraseña" una sola vez en Firebase Console (${firebaseConfig.projectId} → Authentication → Sign-in method).`
        );
      }
      throw err;
    }
  }

  public async signInWithGoogle(): Promise<User> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  }

  public async signOutUser(): Promise<void> {
    this.stopListeners();
    this.pendingOps.clear();
    await signOut(auth);
  }

  public async attachDexie(
    dexieDb: DexieDbLike,
    callbacks?: {
      onRemoteChange?: (tables: CollectionName[]) => void;
      onStatusChange?: (status: SyncStatus) => void;
    }
  ): Promise<void> {
    this.dexieDb = dexieDb;
    if (callbacks?.onRemoteChange) this.onRemoteChangeCb = callbacks.onRemoteChange;
    if (callbacks?.onStatusChange) this.onStatusChangeCb = callbacks.onStatusChange;

    if (!this.hooksAttached) {
      this.attachDexieHooks(dexieDb);
      this.hooksAttached = true;
    }

    if (this.currentUser) {
      await this.startSyncSession(this.currentUser);
    }
    this.emitStatus();
  }

  private attachDexieHooks(dexieDb: DexieDbLike) {
    for (const tableName of COLLECTIONS) {
      const t = dexieDb.table(tableName);

      t.hook('creating', (primKey, obj) => {
        let assignedId = primKey as number | undefined;
        if (!this.isApplyingRemote && tableName !== 'empresa' && (primKey === undefined || primKey === null)) {
          assignedId = nextUniqueId();
          obj.id = assignedId;
        }
        if (this.isApplyingRemote) {
          return assignedId;
        }
        const finalId = Number(assignedId ?? obj.id);
        if (Number.isFinite(finalId)) {
          this.queueOp(tableName, finalId, 'upsert');
        }
        return assignedId;
      });

      t.hook('updating', (_mods, primKey) => {
        if (this.isApplyingRemote) return;
        const id = Number(primKey);
        if (Number.isFinite(id)) {
          this.queueOp(tableName, id, 'upsert');
        }
      });

      t.hook('deleting', (primKey) => {
        if (this.isApplyingRemote) return;
        const id = Number(primKey);
        if (Number.isFinite(id)) {
          this.queueOp(tableName, id, 'delete');
        }
      });
    }
  }

  private queueOp(table: CollectionName, id: number, op: 'upsert' | 'delete') {
    if (!this.currentUser) return;
    this.pendingOps.set(`${table}:${id}`, { table, id, op });
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushChain = this.flushChain.then(() => this.flushPendingOps()).catch((err) => {
        this.lastError = err instanceof Error ? err.message : String(err);
        this.emitStatus();
      });
    }, 60);
  }

  private async flushPendingOps(): Promise<void> {
    if (!this.dexieDb || !this.currentUser) return;
    if (this.pendingOps.size === 0) return;

    const uid = this.currentUser.uid;
    const ops = Array.from(this.pendingOps.values());
    this.pendingOps.clear();

    const resolved: Array<{ table: CollectionName; id: number; op: 'upsert' | 'delete'; data?: Record<string, unknown> }> = [];
    for (const item of ops) {
      if (item.op === 'delete') {
        resolved.push(item);
      } else {
        const localObj = await this.dexieDb.table(item.table).get(item.id);
        if (localObj) {
          resolved.push({
            ...item,
            data: sanitizeForFirestore(item.table, localObj, uid)
          });
        }
      }
    }

    if (resolved.length === 0) return;

    if (resolved.length === 1) {
      const single = resolved[0];
      const docPath = `users/${uid}/${single.table}/${single.id}`;
      try {
        if (single.op === 'delete') {
          await deleteDoc(doc(dbFs, 'users', uid, single.table, String(single.id)));
        } else if (single.data) {
          await setDoc(doc(dbFs, 'users', uid, single.table, String(single.id)), single.data);
        }
      } catch (error) {
        handleFirestoreError(
          error,
          single.op === 'delete' ? OperationType.DELETE : OperationType.WRITE,
          docPath
        );
      }
      return;
    }

    const CHUNK = 400;
    for (let i = 0; i < resolved.length; i += CHUNK) {
      const slice = resolved.slice(i, i + CHUNK);
      const batch = writeBatch(dbFs);
      for (const entry of slice) {
        const ref = doc(dbFs, 'users', uid, entry.table, String(entry.id));
        if (entry.op === 'delete') batch.delete(ref);
        else if (entry.data) batch.set(ref, entry.data);
      }
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${uid}/batch`);
      }
    }
  }

  private stopListeners() {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.remoteIdsByTable.clear();
  }

  private async startSyncSession(user: User): Promise<void> {
    if (!this.dexieDb) return;
    this.stopListeners();
    this.syncing = true;
    this.lastError = null;
    this.emitStatus();

    const uid = user.uid;

    try {
      // 1. Comprobar estado actual en Firestore vs local
      let cloudBusinessCount = 0;
      let cloudEmpresaExists = false;

      for (const table of COLLECTIONS) {
        const colPath = `users/${uid}/${table}`;
        const q = query(collection(dbFs, 'users', uid, table), where('ownerId', '==', uid));
        try {
          const snap = await getDocs(q);
          const idSet = new Set<number>();
          snap.forEach((d) => {
            const raw = d.data() as Record<string, unknown>;
            const numId = Number(raw.id ?? d.id);
            if (Number.isFinite(numId)) idSet.add(numId);
          });
          this.remoteIdsByTable.set(table, idSet);
          if (table === 'empresa') {
            cloudEmpresaExists = snap.size > 0;
          } else {
            cloudBusinessCount += snap.size;
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.LIST, colPath);
        }
      }

      // Contar datos locales
      let localBusinessCount = 0;
      for (const table of BUSINESS_COLLECTIONS) {
        localBusinessCount += await this.dexieDb.table(table).count();
      }
      const localEmp = await this.dexieDb.table('empresa').get(1);
      const localEmpCustomized = Boolean(
        localEmp &&
          (localEmp.cif ||
            localEmp.direccion ||
            localEmp.telefono ||
            localEmp.email ||
            localEmp.logo ||
            localEmp.apiKeyGemini ||
            localEmp.pinHash ||
            (localEmp.nombre && localEmp.nombre !== 'babyluc'))
      );

      // 2. Si la nube está vacía pero el dispositivo tiene datos previos (ej. móvil), subir todo automáticamente
      if (cloudBusinessCount === 0 && !cloudEmpresaExists && (localBusinessCount > 0 || localEmpCustomized)) {
        await this.pushAllLocalDirectly(uid);
        try { localStorage.setItem('babyluc_cloud_uid', uid); } catch { /* noop */ }
      } else if (cloudBusinessCount === 0 && !cloudEmpresaExists && localEmp) {
        // Subir configuración base si no existe aún en nube
        const batch = writeBatch(dbFs);
        batch.set(
          doc(dbFs, 'users', uid, 'empresa', '1'),
          sanitizeForFirestore('empresa', localEmp, uid)
        );
        try {
          await batch.commit();
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${uid}/empresa/1`);
        }
        try { localStorage.setItem('babyluc_cloud_uid', uid); } catch { /* noop */ }
      } else {
        // Si es la primera vez que este dispositivo conecta con la nube pero ya tenía datos locales previos,
        // movemos los datos locales que colisionen a IDs libres antes de bajar la nube para no perder nada.
        let prevSyncedUid: string | null = null;
        try { prevSyncedUid = localStorage.getItem('babyluc_cloud_uid'); } catch { /* noop */ }
        if (prevSyncedUid !== uid && localBusinessCount > 0) {
          await this.remapLocalBeforeMerge();
          await this.mergeLocalIntoCloud();
        }
        // Nube ya tiene datos: descargar snapshot inicial y detectar si hay registros locales sin subir
        await this.pullInitialAndCountPendingLocal(uid);
        try { localStorage.setItem('babyluc_cloud_uid', uid); } catch { /* noop */ }
      }

      // 3. Activar listeners en tiempo real para todas las colecciones
      this.attachRealtimeListeners(uid);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.syncing = false;
      this.emitStatus();
    }
  }

  private async pullInitialAndCountPendingLocal(uid: string): Promise<void> {
    if (!this.dexieDb) return;

    // Detectar cuántos registros locales de negocio no están en la nube
    let pending = 0;
    for (const table of BUSINESS_COLLECTIONS) {
      const remoteIds = this.remoteIdsByTable.get(table) || new Set<number>();
      const localRows = await this.dexieDb.table(table).toArray();
      for (const r of localRows) {
        if (!remoteIds.has(Number(r.id))) pending++;
      }
    }
    this.pendingLocalCount = pending;

    // Aplicar datos iniciales de Firestore en Dexie
    const changed: CollectionName[] = [];
    for (const table of COLLECTIONS) {
      const colPath = `users/${uid}/${table}`;
      const q = query(collection(dbFs, 'users', uid, table), where('ownerId', '==', uid));
      try {
        const snap = await getDocs(q);
        if (!snap.empty) {
          const docs = snap.docs.map((d) => d.data() as Record<string, unknown>);
          await this.applyRemoteUpserts(table, docs);
          changed.push(table);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, colPath);
      }
    }

    if (changed.length && this.onRemoteChangeCb) {
      this.onRemoteChangeCb(changed);
    }
  }

  private async pushAllLocalDirectly(uid: string): Promise<void> {
    if (!this.dexieDb) return;
    const writes: Array<{ table: CollectionName; id: number; data: Record<string, unknown> }> = [];

    for (const table of COLLECTIONS) {
      const rows = await this.dexieDb.table(table).toArray();
      for (const row of rows) {
        const id = Number(row.id);
        if (!Number.isFinite(id)) continue;
        writes.push({
          table,
          id,
          data: sanitizeForFirestore(table, row, uid)
        });
      }
    }

    const CHUNK = 400;
    for (let i = 0; i < writes.length; i += CHUNK) {
      const slice = writes.slice(i, i + CHUNK);
      const batch = writeBatch(dbFs);
      for (const w of slice) {
        batch.set(doc(dbFs, 'users', uid, w.table, String(w.id)), w.data);
      }
      try {
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${uid}/migration`);
      }
    }
    this.pendingLocalCount = 0;
  }

  private async remapLocalBeforeMerge(): Promise<void> {
    if (!this.dexieDb) return;
    this.isApplyingRemote = true;
    try {
      const remapTable = async (
        table: CollectionName,
        fkUpdater?: (row: Record<string, unknown>) => Record<string, unknown>
      ): Promise<Map<number, number>> => {
        const t = this.dexieDb!.table(table);
        const remote = this.remoteIdsByTable.get(table) || new Set<number>();
        const rows = await t.toArray();
        const map = new Map<number, number>();
        for (const r of rows) {
          const oid = Number(r.id);
          const updated = fkUpdater ? fkUpdater({ ...r }) : { ...r };
          if (remote.has(oid)) {
            const nid = nextUniqueId();
            map.set(oid, nid);
            await t.delete(oid);
            updated.id = nid;
            await t.put(updated);
          } else {
            map.set(oid, oid);
            if (fkUpdater) await t.put(updated);
          }
        }
        return map;
      };

      const catMap = await remapTable('categorias');
      const provMap = await remapTable('proveedores');
      const artMap = await remapTable('articulos', (r) => {
        if (r.categoriaId && catMap.has(Number(r.categoriaId))) r.categoriaId = catMap.get(Number(r.categoriaId));
        if (r.proveedorId && provMap.has(Number(r.proveedorId))) r.proveedorId = provMap.get(Number(r.proveedorId));
        return r;
      });
      const varMap = await remapTable('variantes', (r) => {
        if (r.articuloId && artMap.has(Number(r.articuloId))) r.articuloId = artMap.get(Number(r.articuloId));
        return r;
      });
      const cliMap = await remapTable('clientes');
      const pedMap = await remapTable('pedidos', (r) => {
        if (r.clienteId && cliMap.has(Number(r.clienteId))) r.clienteId = cliMap.get(Number(r.clienteId));
        return r;
      });
      await remapTable('lineasPedido', (r) => {
        if (r.pedidoId && pedMap.has(Number(r.pedidoId))) r.pedidoId = pedMap.get(Number(r.pedidoId));
        if (r.articuloId && artMap.has(Number(r.articuloId))) r.articuloId = artMap.get(Number(r.articuloId));
        if (r.varianteId && varMap.has(Number(r.varianteId))) r.varianteId = varMap.get(Number(r.varianteId));
        return r;
      });
      await remapTable('facturas_compra', (r) => {
        if (r.proveedorId && provMap.has(Number(r.proveedorId))) r.proveedorId = provMap.get(Number(r.proveedorId));
        return r;
      });
      await remapTable('registros_iva');
      await remapTable('movimientos_stock', (r) => {
        if (r.articuloId && artMap.has(Number(r.articuloId))) r.articuloId = artMap.get(Number(r.articuloId));
        if (r.varianteId && varMap.has(Number(r.varianteId))) r.varianteId = varMap.get(Number(r.varianteId));
        return r;
      });
    } finally {
      this.isApplyingRemote = false;
    }
  }

  /**
   * Fusiona datos locales pendientes hacia Firestore remapeando IDs en caso de colisión
   * para no sobrescribir datos ya existentes en la nube.
   */
  public async mergeLocalIntoCloud(): Promise<number> {
    if (!this.dexieDb || !this.currentUser) {
      throw new Error('Debes iniciar sesión primero.');
    }
    const uid = this.currentUser.uid;
    this.syncing = true;
    this.emitStatus();

    try {
      // Refrescar conjunto de IDs remotos actuales
      for (const table of COLLECTIONS) {
        const colPath = `users/${uid}/${table}`;
        const q = query(collection(dbFs, 'users', uid, table), where('ownerId', '==', uid));
        try {
          const snap = await getDocs(q);
          const idSet = new Set<number>();
          snap.forEach((d) => {
            const numId = Number((d.data() as Record<string, unknown>).id ?? d.id);
            if (Number.isFinite(numId)) idSet.add(numId);
          });
          this.remoteIdsByTable.set(table, idSet);
        } catch (error) {
          handleFirestoreError(error, OperationType.LIST, colPath);
        }
      }

      const catIdMap = new Map<number, number>();
      const provIdMap = new Map<number, number>();
      const artIdMap = new Map<number, number>();
      const varIdMap = new Map<number, number>();
      const cliIdMap = new Map<number, number>();
      const pedIdMap = new Map<number, number>();

      const writes: Array<{ table: CollectionName; id: number; data: Record<string, unknown> }> = [];

      const reserveId = (table: CollectionName, oldId: number): number => {
        const remote = this.remoteIdsByTable.get(table) || new Set<number>();
        if (!remote.has(oldId)) {
          remote.add(oldId);
          return oldId;
        }
        const nid = nextUniqueId();
        remote.add(nid);
        return nid;
      };

      // 1. Categorías
      for (const row of await this.dexieDb.table('categorias').toArray()) {
        const oid = Number(row.id);
        if ((this.remoteIdsByTable.get('categorias') || new Set()).has(oid)) continue;
        const nid = reserveId('categorias', oid);
        catIdMap.set(oid, nid);
        writes.push({ table: 'categorias', id: nid, data: sanitizeForFirestore('categorias', { ...row, id: nid }, uid) });
      }

      // 2. Proveedores
      for (const row of await this.dexieDb.table('proveedores').toArray()) {
        const oid = Number(row.id);
        if ((this.remoteIdsByTable.get('proveedores') || new Set()).has(oid)) continue;
        const nid = reserveId('proveedores', oid);
        provIdMap.set(oid, nid);
        writes.push({ table: 'proveedores', id: nid, data: sanitizeForFirestore('proveedores', { ...row, id: nid }, uid) });
      }

      // 3. Artículos
      for (const row of await this.dexieDb.table('articulos').toArray()) {
        const oid = Number(row.id);
        if ((this.remoteIdsByTable.get('articulos') || new Set()).has(oid)) continue;
        const nid = reserveId('articulos', oid);
        artIdMap.set(oid, nid);
        const mappedCat = row.categoriaId ? (catIdMap.get(Number(row.categoriaId)) ?? Number(row.categoriaId)) : null;
        const mappedProv = row.proveedorId ? (provIdMap.get(Number(row.proveedorId)) ?? Number(row.proveedorId)) : null;
        writes.push({
          table: 'articulos',
          id: nid,
          data: sanitizeForFirestore('articulos', { ...row, id: nid, categoriaId: mappedCat, proveedorId: mappedProv }, uid)
        });
      }

      // 4. Variantes
      for (const row of await this.dexieDb.table('variantes').toArray()) {
        const oid = Number(row.id);
        if ((this.remoteIdsByTable.get('variantes') || new Set()).has(oid)) continue;
        const nid = reserveId('variantes', oid);
        varIdMap.set(oid, nid);
        const mappedArt = artIdMap.get(Number(row.articuloId)) ?? Number(row.articuloId);
        writes.push({
          table: 'variantes',
          id: nid,
          data: sanitizeForFirestore('variantes', { ...row, id: nid, articuloId: mappedArt }, uid)
        });
      }

      // 5. Clientes
      for (const row of await this.dexieDb.table('clientes').toArray()) {
        const oid = Number(row.id);
        if ((this.remoteIdsByTable.get('clientes') || new Set()).has(oid)) continue;
        const nid = reserveId('clientes', oid);
        cliIdMap.set(oid, nid);
        writes.push({ table: 'clientes', id: nid, data: sanitizeForFirestore('clientes', { ...row, id: nid }, uid) });
      }

      // 6. Pedidos
      for (const row of await this.dexieDb.table('pedidos').toArray()) {
        const oid = Number(row.id);
        if ((this.remoteIdsByTable.get('pedidos') || new Set()).has(oid)) continue;
        const nid = reserveId('pedidos', oid);
        pedIdMap.set(oid, nid);
        const mappedCli = row.clienteId ? (cliIdMap.get(Number(row.clienteId)) ?? Number(row.clienteId)) : null;
        writes.push({
          table: 'pedidos',
          id: nid,
          data: sanitizeForFirestore('pedidos', { ...row, id: nid, clienteId: mappedCli }, uid)
        });
      }

      // 7. Líneas de pedido
      for (const row of await this.dexieDb.table('lineasPedido').toArray()) {
        const oid = Number(row.id);
        if ((this.remoteIdsByTable.get('lineasPedido') || new Set()).has(oid)) continue;
        const nid = reserveId('lineasPedido', oid);
        const mappedPed = pedIdMap.get(Number(row.pedidoId)) ?? Number(row.pedidoId);
        const mappedArt = row.articuloId ? (artIdMap.get(Number(row.articuloId)) ?? Number(row.articuloId)) : null;
        const mappedVar = row.varianteId ? (varIdMap.get(Number(row.varianteId)) ?? Number(row.varianteId)) : null;
        writes.push({
          table: 'lineasPedido',
          id: nid,
          data: sanitizeForFirestore(
            'lineasPedido',
            { ...row, id: nid, pedidoId: mappedPed, articuloId: mappedArt, varianteId: mappedVar },
            uid
          )
        });
      }

      // 8. Facturas de compra
      for (const row of await this.dexieDb.table('facturas_compra').toArray()) {
        const oid = Number(row.id);
        if ((this.remoteIdsByTable.get('facturas_compra') || new Set()).has(oid)) continue;
        const nid = reserveId('facturas_compra', oid);
        const mappedProv = row.proveedorId ? (provIdMap.get(Number(row.proveedorId)) ?? Number(row.proveedorId)) : null;
        writes.push({
          table: 'facturas_compra',
          id: nid,
          data: sanitizeForFirestore('facturas_compra', { ...row, id: nid, proveedorId: mappedProv }, uid)
        });
      }

      // 9. Registros IVA
      for (const row of await this.dexieDb.table('registros_iva').toArray()) {
        const oid = Number(row.id);
        if ((this.remoteIdsByTable.get('registros_iva') || new Set()).has(oid)) continue;
        const nid = reserveId('registros_iva', oid);
        writes.push({
          table: 'registros_iva',
          id: nid,
          data: sanitizeForFirestore('registros_iva', { ...row, id: nid }, uid)
        });
      }

      // 10. Movimientos de stock
      for (const row of await this.dexieDb.table('movimientos_stock').toArray()) {
        const oid = Number(row.id);
        if ((this.remoteIdsByTable.get('movimientos_stock') || new Set()).has(oid)) continue;
        const nid = reserveId('movimientos_stock', oid);
        const mappedArt = row.articuloId ? (artIdMap.get(Number(row.articuloId)) ?? Number(row.articuloId)) : null;
        const mappedVar = row.varianteId ? (varIdMap.get(Number(row.varianteId)) ?? Number(row.varianteId)) : null;
        writes.push({
          table: 'movimientos_stock',
          id: nid,
          data: sanitizeForFirestore(
            'movimientos_stock',
            { ...row, id: nid, articuloId: mappedArt, varianteId: mappedVar },
            uid
          )
        });
      }

      const CHUNK = 400;
      for (let i = 0; i < writes.length; i += CHUNK) {
        const slice = writes.slice(i, i + CHUNK);
        const batch = writeBatch(dbFs);
        for (const w of slice) {
          batch.set(doc(dbFs, 'users', uid, w.table, String(w.id)), w.data);
        }
        try {
          await batch.commit();
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${uid}/merge`);
        }
      }

      this.pendingLocalCount = 0;
      return writes.length;
    } finally {
      this.syncing = false;
      this.emitStatus();
    }
  }

  public async syncRestoredBackupToCloud(): Promise<void> {
    if (!this.dexieDb || !this.currentUser) return;
    const uid = this.currentUser.uid;
    this.syncing = true;
    this.emitStatus();
    try {
      this.pendingOps.clear();
      const ops: Array<{ op: 'set' | 'delete'; table: CollectionName; id: number; data?: Record<string, unknown> }> = [];
      for (const table of COLLECTIONS) {
        const localRows = await this.dexieDb.table(table).toArray();
        const localIds = new Set(localRows.map((r) => Number(r.id)).filter(Number.isFinite));
        for (const row of localRows) {
          const id = Number(row.id);
          if (!Number.isFinite(id)) continue;
          ops.push({ op: 'set', table, id, data: sanitizeForFirestore(table, row, uid) });
        }
        const q = query(collection(dbFs, 'users', uid, table), where('ownerId', '==', uid));
        const snap = await getDocs(q);
        snap.forEach((d) => {
          const rid = Number((d.data() as Record<string, unknown>).id ?? d.id);
          if (Number.isFinite(rid) && !localIds.has(rid)) {
            ops.push({ op: 'delete', table, id: rid });
          }
        });
      }
      const CHUNK = 400;
      for (let i = 0; i < ops.length; i += CHUNK) {
        const slice = ops.slice(i, i + CHUNK);
        const batch = writeBatch(dbFs);
        for (const entry of slice) {
          const ref = doc(dbFs, 'users', uid, entry.table, String(entry.id));
          if (entry.op === 'delete') batch.delete(ref);
          else if (entry.data) batch.set(ref, entry.data);
        }
        try {
          await batch.commit();
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${uid}/restore`);
        }
      }
      this.pendingLocalCount = 0;
    } finally {
      this.syncing = false;
      this.emitStatus();
    }
  }

  private attachRealtimeListeners(uid: string) {
    for (const table of COLLECTIONS) {
      const colPath = `users/${uid}/${table}`;
      const q = query(collection(dbFs, 'users', uid, table), where('ownerId', '==', uid));
      let firstSnapshot = true;

      const unsub = onSnapshot(
        q,
        async (snapshot) => {
          if (firstSnapshot) {
            firstSnapshot = false;
            return;
          }
          const changes = snapshot.docChanges();
          if (changes.length === 0) return;

          const upserts: Record<string, unknown>[] = [];
          const deletes: number[] = [];

          for (const ch of changes) {
            const raw = ch.doc.data() as Record<string, unknown>;
            const id = Number(raw.id ?? ch.doc.id);
            if (!Number.isFinite(id)) continue;
            if (ch.type === 'removed') {
              deletes.push(id);
            } else {
              upserts.push(raw);
            }
          }

          if (upserts.length) await this.applyRemoteUpserts(table, upserts);
          if (deletes.length) await this.applyRemoteDeletes(table, deletes);

          if ((upserts.length || deletes.length) && this.onRemoteChangeCb) {
            this.onRemoteChangeCb([table]);
          }
        },
        (error) => {
          this.lastError = error instanceof Error ? error.message : String(error);
          this.emitStatus();
          handleFirestoreError(error, OperationType.GET, colPath);
        }
      );

      this.unsubscribers.push(unsub);
    }
  }

  private async applyRemoteUpserts(table: CollectionName, docs: Record<string, unknown>[]): Promise<void> {
    if (!this.dexieDb) return;
    const t = this.dexieDb.table(table);
    this.isApplyingRemote = true;
    try {
      for (const raw of docs) {
        const clean: Record<string, unknown> = { ...raw };
        delete clean.ownerId;
        const id = Number(clean.id);
        if (!Number.isFinite(id)) continue;
        clean.id = id;

        // Resolver posibles colisiones de índices únicos locales
        try {
          if (table === 'categorias' && typeof clean.nombre === 'string') {
            const existing = await t.where('nombre').equals(clean.nombre).first();
            if (existing && Number(existing.id) !== id) await t.delete(Number(existing.id));
          } else if (table === 'pedidos' && typeof clean.numero === 'string') {
            const existing = await t.where('numero').equals(clean.numero).first();
            if (existing && Number(existing.id) !== id) await t.delete(Number(existing.id));
          } else if (table === 'variantes') {
            const existing = await t
              .where('[articuloId+talla+color]')
              .equals([Number(clean.articuloId), String(clean.talla || ''), String(clean.color || '')])
              .first();
            if (existing && Number(existing.id) !== id) await t.delete(Number(existing.id));
          } else if (table === 'registros_iva') {
            const existing = await t
              .where('[año+trimestre]')
              .equals([Number(clean['año']), Number(clean.trimestre)])
              .first();
            if (existing && Number(existing.id) !== id) await t.delete(Number(existing.id));
          }
        } catch {
          // Ignorar si la versión/índice no coincide
        }

        await t.put(clean);
      }
    } finally {
      this.isApplyingRemote = false;
    }
  }

  private async applyRemoteDeletes(table: CollectionName, ids: number[]): Promise<void> {
    if (!this.dexieDb) return;
    const t = this.dexieDb.table(table);
    this.isApplyingRemote = true;
    try {
      for (const id of ids) {
        await t.delete(id);
      }
    } finally {
      this.isApplyingRemote = false;
    }
  }
}

export const firebaseBridge = new BabylucFirebaseBridge();
