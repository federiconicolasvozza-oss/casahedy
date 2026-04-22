// Google Apps Script — Casa Hedy Leads
// Pegar en: script.google.com > Nuevo proyecto
// Implementar > Nueva implementación > App web > Cualquier persona
// Copiar URL y pegar en GOOGLE_SHEET_WEBHOOK

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    // Crear encabezados si la hoja está vacía
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'Fecha', 'Teléfono', 'Nombre', 'Interés/Motivo',
        'Lead Score', 'Mensajes', 'Calificado', 'Ticket Alto'
      ]);
      sheet.getRange(1, 1, 1, 8)
        .setFontWeight('bold')
        .setBackground('#1a73e8')
        .setFontColor('white');
    }

    // Verificar si ya existe este teléfono (actualizar en vez de duplicar)
    var phones = sheet.getRange(2, 2, Math.max(sheet.getLastRow() - 1, 1), 1).getValues();
    var existingRow = -1;
    for (var i = 0; i < phones.length; i++) {
      if (String(phones[i][0]) === String(data.telefono)) {
        existingRow = i + 2; // +2 por header y 0-index
        break;
      }
    }

    var rowData = [
      data.fecha || new Date().toISOString(),
      data.telefono || '',
      data.nombre || '',
      data.motivo || '',
      data.leadScore || 0,
      data.mensajes || 0,
      data.calificado || 'NO',
      data.ticketAlto || 'NO'
    ];

    if (existingRow > 0) {
      // Actualizar fila existente
      sheet.getRange(existingRow, 1, 1, 8).setValues([rowData]);
    } else {
      // Nueva fila
      sheet.appendRow(rowData);
      existingRow = sheet.getLastRow();
    }

    // Colorear leads calificados
    if (data.calificado === 'SÍ') {
      sheet.getRange(existingRow, 1, 1, 8).setBackground('#e6f4ea');
    }

    return ContentService.createTextOutput(
      JSON.stringify({ status: 'ok' })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: 'error', message: error.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ status: 'ok', message: 'Casa Hedy Leads Webhook activo' })
  ).setMimeType(ContentService.MimeType.JSON);
}
