(function () {
  const DEFAULT_HEADERS = {
    "Content-Type": "application/json",
  };

  function getToken() {
    return (
      localStorage.getItem("admin_token") ||
      localStorage.getItem("token") ||
      localStorage.getItem("authToken") ||
      ""
    );
  }

  async function request(url, options = {}) {
    const token = getToken();

    const headers = {
      ...DEFAULT_HEADERS,
      ...(options.headers || {}),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const config = {
      method: options.method || "GET",
      headers,
      credentials: "include",
      ...options,
    };

    const response = await fetch(url, config);

    let data = null;
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const message =
        (data && data.message) ||
        (typeof data === "string" && data) ||
        "Erro ao comunicar com o servidor.";
      throw new Error(message);
    }

    return data;
  }

  window.ApiClient = {
    get: function (url, options = {}) {
      return request(url, { ...options, method: "GET" });
    },

    post: function (url, body, options = {}) {
      return request(url, {
        ...options,
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    put: function (url, body, options = {}) {
      return request(url, {
        ...options,
        method: "PUT",
        body: JSON.stringify(body),
      });
    },

    patch: function (url, body, options = {}) {
      return request(url, {
        ...options,
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },

    delete: function (url, options = {}) {
      return request(url, {
        ...options,
        method: "DELETE",
      });
    },
  };
})();