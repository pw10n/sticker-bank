# syntax=docker/dockerfile:1
# Sticker Bank: one image serving the JSON API and the built React PWA (same origin).

# ---- Stage 1: build the web app (runs natively on the build host) ----
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
ARG APP_VERSION=dev
RUN VITE_APP_VERSION=$APP_VERSION npm run build

# ---- Stage 2: build the Spring Boot jar and extract layers ----
FROM --platform=$BUILDPLATFORM eclipse-temurin:25-jdk AS api
WORKDIR /src/backend
COPY backend/ ./
# backend/build.gradle.kts processResources copies ../artwork/catalog.json into artwork/
COPY artwork/catalog.json /src/artwork/catalog.json
COPY --from=web /src/frontend/dist/ src/main/resources/static/
ARG APP_VERSION=dev
# The Gradle toolchain asks for Java 25 (foojay resolver). This stage already runs on a
# JDK 25, so the toolchain is satisfied by the running JVM and no JDK download happens.
# Only the Gradle distribution (via the wrapper) and Maven dependencies are fetched.
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon bootJar -PappVersion=$APP_VERSION \
    && java -Djarmode=tools -jar build/libs/sticker-bank.jar extract --layers --launcher --destination /out

# ---- Stage 3: runtime ----
FROM eclipse-temurin:25-jre
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home app
WORKDIR /app
COPY --from=api /out/dependencies/ ./
COPY --from=api /out/spring-boot-loader/ ./
COPY --from=api /out/snapshot-dependencies/ ./
COPY --from=api /out/application/ ./
USER 10001:10001
EXPOSE 8080 8081
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60"
ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
