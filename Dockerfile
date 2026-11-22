# One container: Spring Boot serves the REST API and the website (frontend is packaged into the jar).
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY backend backend
COPY frontend frontend
RUN mvn -q -f backend/pom.xml -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /app/backend/target/*.jar app.jar
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "java -Xmx384m -XX:+UseSerialGC -jar app.jar"]
