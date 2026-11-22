package com.exsub.error;

import java.util.List;

/** Domain error carrying an HTTP status, a machine-readable code and optional hints. */
public class ApiException extends RuntimeException {

    private final int status;
    private final String code;
    private final List<String> hints;

    public ApiException(int status, String code, String message, List<String> hints) {
        super(message);
        this.status = status;
        this.code = code;
        this.hints = hints == null ? List.of() : List.copyOf(hints);
    }

    public static ApiException badRequest(String code, String message, List<String> hints) {
        return new ApiException(400, code, message, hints);
    }

    public static ApiException notFound(String code, String message, List<String> hints) {
        return new ApiException(404, code, message, hints);
    }

    public static ApiException catalogEmpty() {
        return new ApiException(503, "CATALOG_EMPTY",
                "The exercise catalog is empty, so no search or substitution can be performed. "
                        + "Check the data file path (EXSUB_DATA_EXERCISESPATH) and regenerate sample data.", List.of());
    }

    public int status() { return status; }
    public String code() { return code; }
    public List<String> hints() { return hints; }
}
