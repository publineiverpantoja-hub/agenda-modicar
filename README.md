# MODICAR Agenda

Aplicación web funcional para solicitar y administrar citas de valoración de **MODICAR Estética Automotriz**, ubicada en **Carrera 29 #33-34, Centro de Palmira, Valle del Cauca**.

## Funciones incluidas

- Agenda pública desde celular o computador.
- Selección de servicio, vehículo, fecha y horario.
- Bloqueo automático de horarios ya reservados.
- Confirmación con código único.
- Botón de confirmación por WhatsApp.
- Panel administrativo protegido por clave.
- Estados: pendiente, confirmada, completada y cancelada.
- Buscador, filtros y exportación de citas a CSV.
- Diseño adaptable e instalable como aplicación web.

## Iniciar en un computador

1. Instala Node.js 20 o superior.
2. Abre una terminal dentro de esta carpeta.
3. Ejecuta:

```bash
npm install
npm start
```

4. Abre `http://localhost:3000`.
5. Panel administrativo: `http://localhost:3000/admin.html`.

Clave inicial del panel: `modicar2026`

**Cámbiala antes de publicar la aplicación.**

## Configuración importante

Configura estas variables en el servicio donde publiques la aplicación:

```text
ADMIN_PASSWORD=una-clave-segura
MODICAR_WHATSAPP=573138494513
MODICAR_ADDRESS=Carrera 29 #33-34, Centro de Palmira, Valle del Cauca
PORT=3000
DATABASE_URL=postgresql://usuario:clave@servidor/base_de_datos
```

El número de WhatsApp debe llevar código de país y solo números. Ejemplo colombiano: `573001234567`.

## Identidad y ubicación configuradas

La aplicación ya incluye el logo oficial suministrado por MODICAR, sin rediseñar sus colores ni proporciones:

```text
public/logo-modicar.png
```

También incluye la dirección **Carrera 29 #33-34, Centro de Palmira** y el número **313 849 4513** en el encabezado, la sección de ubicación, la agenda, el mapa y el pie de página.

## Datos

En el computador, las citas se guardan en:

```text
data/appointments.json
```

En una publicación real, la carpeta `data` debe permanecer guardada de forma persistente. Realiza copias de seguridad periódicas del archivo.

En hosting, configura `DATABASE_URL` con una base de datos PostgreSQL. La tabla
necesaria se crea automáticamente al iniciar la aplicación.

## Publicación

La carpeta incluye un `Dockerfile`, por lo que puede publicarse en un servidor compatible con Node.js o contenedores. Configura las variables anteriores y asegúrate de disponer de almacenamiento persistente para la carpeta `data`.
