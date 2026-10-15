---
layout: home
title: PayIncus Documentation
description: PayIncus deployment, operations, development, and OTA documentation
---

<main class="docs-home">
  <section class="docs-home-masthead">
    <div class="docs-home-brand">
      <img class="docs-home-logo" src="/incudal_logo.webp" alt="PayIncus">
      <div>
        <p class="docs-home-eyebrow">PayIncus Documentation</p>
        <h1>PayIncus Docs</h1>
        <p class="docs-home-summary">Deployment, operations, API integration, and production maintenance for the PayIncus Incus delivery platform, including the user portal, admin console, and admin OTA updates. Start with the task in front of you.</p>
        <div class="docs-home-actions">
          <a class="docs-home-button primary" href="/payincus/en/deployment/one-click-install">Deploy PayIncus</a>
          <a class="docs-home-button" href="/payincus/en/guide/introduction">Understand the system</a>
          <a class="docs-home-button" href="/payincus/en/api/overview">View the API</a>
        </div>
      </div>
    </div>
    <aside class="docs-home-release">
      <span>Production Operations</span>
      <strong>Releases and updates</strong>
      <p>Installation, OTA, and rollback use GitHub Releases with SHA256 verification as the source of truth.</p>
      <a href="/payincus/en/release/version-log">Review the version log</a>
    </aside>
  </section>

  <section class="docs-home-section">
    <div class="docs-home-section-label">
      <h2>Start here</h2>
      <p>Choose the entry closest to your current task.</p>
    </div>
    <div class="docs-home-links">
      <a class="docs-home-link" href="/payincus/en/deployment/one-click-install"><span class="docs-home-link-index">01</span><span><strong>One-click install</strong><small>Bootstrap a clean Debian or Ubuntu server.</small></span></a>
      <a class="docs-home-link" href="/payincus/en/deployment/manual-install"><span class="docs-home-link-index">02</span><span><strong>Manual install</strong><small>Integrate with existing PostgreSQL, Nginx, systemd, and release operations.</small></span></a>
      <a class="docs-home-link" href="/payincus/en/guide/split-deployment"><span class="docs-home-link-index">03</span><span><strong>Split deployment</strong><small>Configure user, admin, API, and domain boundaries.</small></span></a>
      <a class="docs-home-link" href="/payincus/en/guide/ota-update"><span class="docs-home-link-index">04</span><span><strong>Admin OTA</strong><small>Verify Releases, switch versions, and run controlled rollback.</small></span></a>
    </div>
  </section>

  <section class="docs-home-section">
    <div class="docs-home-section-label">
      <h2>Browse by work</h2>
      <p>The information architecture follows deployment, operations, and development work.</p>
    </div>
    <div class="docs-home-columns">
      <div class="docs-home-column">
        <h3>Deploy and operate</h3>
        <a href="/payincus/en/deployment/environment">Environment variables</a>
        <a href="/payincus/en/deployment/systemd">systemd service</a>
        <a href="/payincus/en/deployment/nginx">Nginx split deployment</a>
        <a href="/payincus/en/troubleshooting/common-errors">Common errors</a>
      </div>
      <div class="docs-home-column">
        <h3>Product operations</h3>
        <a href="/payincus/en/user/dashboard">User portal</a>
        <a href="/payincus/en/admin/overview">Admin console</a>
        <a href="/payincus/en/features/billing">Payments and billing</a>
        <a href="/payincus/en/features/instances">Instances and delivery</a>
      </div>
      <div class="docs-home-column">
        <h3>API and integration</h3>
        <a href="/payincus/en/api/overview">Public API</a>
        <a href="/payincus/en/api/overview#oauth">OAuth Provider</a>
      </div>
    </div>
  </section>

  <section class="docs-home-section">
    <div class="docs-home-section-label">
      <h2>Project links</h2>
      <p>Source, community, and demo environment.</p>
    </div>
    <div class="docs-home-links">
      <a class="docs-home-link" href="https://github.com/mastalee928/payincus"><span class="docs-home-link-index">GH</span><span><strong>GitHub</strong><small>Source, Releases, and issue tracking.</small></span></a>
      <a class="docs-home-link" href="https://github.com/mastalee928/payincus/issues"><span class="docs-home-link-index">TG</span><span><strong>Issues</strong><small>Report issues and request features in this repository.</small></span></a>
      <a class="docs-home-link" href="/payincus/en/demo"><span class="docs-home-link-index">DE</span><span><strong>Live Demo</strong><small>Demo accounts and read-only limitations.</small></span></a>
    </div>
  </section>
</main>
