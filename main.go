package main

import (
	"embed"
	"infraatlas/app"
)

//go:embed static
var staticFS embed.FS

func main() {
	app.Run(staticFS)
}
