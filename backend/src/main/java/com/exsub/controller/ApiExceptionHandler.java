package com.exsub.controller;

import com.exsub.error.ApiException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Uniform JSON error body: {status, code, message, hints, timestamp}. */
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> api(ApiException e) {
        return body(e.status(), e.code(), e.getMessage(), e.hints());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> unreadable(HttpMessageNotReadableException e) {
        return body(400, "MALFORMED_JSON", "Request body is not valid JSON for this endpoint.", List.of());
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, Object>> typeMismatch(MethodArgumentTypeMismatchException e) {
        return body(400, "INVALID_PARAMETER", "Parameter '" + e.getName() + "' has an invalid value.", List.of());
    }

    private static ResponseEntity<Map<String, Object>> body(int status, String code, String message, List<String> hints) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("status", status);
        m.put("code", code);
        m.put("message", message);
        m.put("hints", hints);
        m.put("timestamp", Instant.now().toString());
        return ResponseEntity.status(status).body(m);
    }
}
