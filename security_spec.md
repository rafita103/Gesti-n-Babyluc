# Security Specification — babyluc Firestore

## 1. Data Invariants
1. Todos los documentos de negocio (`empresa`, `categorias`, `proveedores`, `articulos`, `variantes`, `clientes`, `pedidos`, `lineasPedido`, `facturas_compra`, `registros_iva`) residen aislados bajo `/users/{userId}/...`.
2. Solo el usuario autenticado y verificado (`request.auth != null && request.auth.token.email_verified == true && request.auth.uid == userId`) puede leer, listar o escribir en sus propias colecciones.
3. Todo documento creado o actualizado debe incluir `ownerId == request.auth.uid`, cumplir estrictamente sus claves permitidas (`hasAll` / `hasOnly`), límites de longitud de cadena (`.size() <= MAX`), tipos primitivos exactos y enums válidos (`Pedido.estado`, `RegistroIva.estado`).
4. Todos los IDs de ruta (`userId`, `docId`) deben cumplir `isValidId()` (`^[a-zA-Z0-9_\\-]+$`, longitud `<= 128`).
5. Los datos personales (PII: clientes, teléfono, dirección, email, NIF) están estrictamente aislados bajo el `userId` propietario; no hay lecturas globales ni acceso cruzado entre cuentas.

## 2. "Dirty Dozen" Attack Payloads (All must return PERMISSION_DENIED)
1. Unauthenticated read/write on `/users/{uid}/articulos/1`.
2. Unverified email user (`email_verified == false`) attempting write on `/users/{uid}/pedidos/1`.
3. Cross-tenant read/list/write (`auth.uid != userId`) on `/users/{otherUid}/clientes`.
4. Identity spoofing: payload with `ownerId: "victim_uid"` written under `/users/{attackerUid}/articulos/1`.
5. Shadow/ghost field injection: adding `isAdmin: true` or `extraField: 1` to any create or update payload.
6. ID poisoning: `docId` with `../` or > 128 chars or spaces.
7. Denial-of-wallet string overflow: `nombre` > 200 chars on `Articulo` or `Cliente`.
8. Invalid enum state on `Pedido`: `estado: "hacked"`.
9. Invalid enum state on `RegistroIva`: `estado: "anulado"`.
10. Invalid type injection: `precioVenta: "cien"` (string instead of number) on `Articulo`.
11. Unbounded array injection: `aliases` or `historialEstados` > max allowed size (e.g., > 50 elements).
12. Changing immutable `ownerId` during `update`.
