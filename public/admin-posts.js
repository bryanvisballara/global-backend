const {
  attachLogout,
  fetchJson,
  loadAdminSession,
  renderEmptyState,
  requireAdminAccess,
  setFeedback,
} = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  const postForm = document.getElementById("post-form");
  const postFeedback = document.getElementById("post-feedback");
  const postsList = document.getElementById("posts-list");
  const postsCount = document.getElementById("posts-count");

  function renderPosts(posts) {
    postsCount.textContent = String(posts.length);

    if (!posts.length) {
      renderEmptyState(postsList, "Todavía no hay publicaciones creadas.");
      return;
    }

    postsList.innerHTML = posts.map((post) => `
      <article class="list-item">
        <div>
          <strong>${post.title}</strong>
          <p>${post.format} · ${post.media?.length || 0} recursos</p>
        </div>
        <span>${post.status}</span>
      </article>
    `).join("");
  }

  async function loadPostsPage() {
    await loadAdminSession();
    const postsData = await fetchJson("/api/admin/posts");
    renderPosts(postsData.posts || []);
  }

  postForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(postForm);

    setFeedback(postFeedback, "Subiendo archivos y creando publicación...");

    try {
      await fetchJson("/api/admin/posts", {
        method: "POST",
        body: formData,
      });

      postForm.reset();
      setFeedback(postFeedback, "Publicación creada correctamente.", "success");
      await loadPostsPage();
    } catch (error) {
      setFeedback(postFeedback, error.message, "error");
    }
  });

  loadPostsPage().catch((error) => {
    renderEmptyState(postsList, error.message);
  });
}